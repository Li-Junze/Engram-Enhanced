// 浏览器版 engramAPI 适配层。
// 桌面版（Electron）由 preload 注入 window.engramAPI，本文件检测到即直接退出；
// 网页版缺失时，用 IndexedDB + 静态词书 JSON 实现同一套接口，
// 业务规则（间隔复习调度、统计口径）与 electron/store.js 保持一致。
(() => {
  if (window.engramAPI) {
    return;
  }

  const APP_VERSION = "1.2.0";
  const INTERVALS_MS = [
    10 * 60 * 1000,
    1 * 24 * 60 * 60 * 1000,
    3 * 24 * 60 * 60 * 1000,
    7 * 24 * 60 * 60 * 1000,
    15 * 24 * 60 * 60 * 1000,
    30 * 24 * 60 * 60 * 1000
  ];

  const DB_NAME = "engram-web";
  const DB_VERSION = 1;
  const STORE_META = "meta"; // key -> value
  const STORE_PROGRESS = "progress"; // keyPath: id
  const STORE_LOGS = "logs"; // keyPath: id, autoIncrement
  const STORE_IMPORTED = "imported"; // keyPath: id（导入备份携带的完整单词内容）

  const runtime = {
    db: null,
    manifest: [],
    currentBookKey: null,
    contentRows: [],
    contentById: new Map(),
    progressById: new Map(),
    logs: [],
    contentSource: new Map() // book_key -> "static" | "imported"
  };

  // ---------- IndexedDB 基础 ----------
  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_META)) {
          db.createObjectStore(STORE_META);
        }
        if (!db.objectStoreNames.contains(STORE_PROGRESS)) {
          db.createObjectStore(STORE_PROGRESS, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(STORE_LOGS)) {
          db.createObjectStore(STORE_LOGS, { keyPath: "id", autoIncrement: true });
        }
        if (!db.objectStoreNames.contains(STORE_IMPORTED)) {
          db.createObjectStore(STORE_IMPORTED, { keyPath: "id" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function tx(storeName, mode) {
    return runtime.db.transaction(storeName, mode).objectStore(storeName);
  }

  function requestToPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function storeGetAll(storeName) {
    return requestToPromise(tx(storeName, "readonly").getAll());
  }

  async function storeGet(storeName, key) {
    return requestToPromise(tx(storeName, "readonly").get(key));
  }

  function storePut(storeName, value, key) {
    const store = tx(storeName, "readwrite");
    return requestToPromise(key === undefined ? store.put(value) : store.put(value, key));
  }

  function storePutAll(storeName, values) {
    return new Promise((resolve, reject) => {
      const transaction = runtime.db.transaction(storeName, "readwrite");
      const store = transaction.objectStore(storeName);
      values.forEach((value) => store.put(value));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }

  function storeClear(storeName) {
    return requestToPromise(tx(storeName, "readwrite").clear());
  }

  // ---------- 日期与调度（与 electron/store.js 一致） ----------
  function normalizeDayStartHour(value) {
    const numeric = Number(value);
    return numeric === 5 ? 5 : 0;
  }

  function getStudyDayStart(date = new Date(), dayStartHour = 0) {
    const hour = normalizeDayStartHour(dayStartHour);
    const start = new Date(date);
    start.setHours(hour, 0, 0, 0);
    if (date < start) {
      start.setDate(start.getDate() - 1);
    }
    return start;
  }

  function addDaysToDate(date, days) {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
  }

  function formatLocalDateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function formatStudyDateKey(date, dayStartHour = 0) {
    return formatLocalDateKey(getStudyDayStart(date, dayStartHour));
  }

  function shuffle(items) {
    const cloned = [...items];
    for (let index = cloned.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [cloned[index], cloned[swapIndex]] = [cloned[swapIndex], cloned[index]];
    }
    return cloned;
  }

  function computeNextReview(stage, action, isNewWord) {
    const maxStage = INTERVALS_MS.length - 1;
    let newStage = stage;
    let wrongIncrement = 0;

    if (action === "unknown") {
      newStage = 0;
      wrongIncrement = 1;
    } else if (action === "vague") {
      newStage = Math.min(Math.max(stage, 0) + 1, maxStage);
    } else if (action === "known") {
      newStage = isNewWord ? 1 : Math.min(Math.max(stage, 0) + 2, maxStage);
    } else {
      throw new Error("不支持的学习反馈");
    }

    return {
      newStage,
      wrongIncrement,
      nextReviewAt: new Date(Date.now() + INTERVALS_MS[newStage]).toISOString()
    };
  }

  // ---------- 进度与内容 ----------
  function emptyProgress(wordId, bookKey) {
    return {
      id: wordId,
      book_key: bookKey,
      stage: 0,
      last_review_at: null,
      next_review_at: null,
      review_count: 0,
      wrong_count: 0
    };
  }

  function getProgress(wordId, bookKey) {
    return progressByIdGet(wordId) || emptyProgress(wordId, bookKey);
  }

  function progressByIdGet(wordId) {
    const row = runtime.progressById.get(wordId);
    return row ? { ...row } : null;
  }

  function wordToTask(row) {
    const progress = getProgress(row.id, row.book_key);
    const isNewWord = !progress.last_review_at;

    return {
      id: row.id,
      book_key: row.book_key,
      word: row.word,
      source_book_id: row.source_book_id,
      phonetic_uk: row.phonetic_uk,
      phonetic_us: row.phonetic_us,
      speech_uk: row.speech_uk || "",
      speech_us: row.speech_us || "",
      examples: row.examples || [],
      translation_summary: row.translation_summary || "",
      meanings: row.meanings || [],
      stage: progress.stage,
      review_count: progress.review_count,
      wrong_count: progress.wrong_count,
      is_new_word: isNewWord,
      task_type: isNewWord ? "new" : "review"
    };
  }

  function manifestBook(bookKey) {
    return runtime.manifest.find((book) => book.key === bookKey) || null;
  }

  function bookSummary(bookKey) {
    const book = manifestBook(bookKey);
    if (!book) {
      return null;
    }

    let learned = 0;
    runtime.progressById.forEach((row) => {
      if (row.book_key === bookKey && row.last_review_at) {
        learned += 1;
      }
    });

    return {
      key: book.key,
      title: book.title,
      source_type: "builtin",
      total_words: book.total_words,
      learned_words: learned,
      new_words: Math.max(book.total_words - learned, 0)
    };
  }

  async function importedRowsForBook(bookKey) {
    const rows = await storeGetAll(STORE_IMPORTED);
    return rows.filter((row) => row.book_key === bookKey);
  }

  async function hasImportedContent() {
    const count = await countStore(STORE_IMPORTED);
    return count > 0;
  }

  function countStore(storeName) {
    return requestToPromise(tx(storeName, "readonly").count());
  }

  async function loadContentForBook(bookKey) {
    let rows = null;
    let source = "static";

    if (await hasImportedContent()) {
      rows = await importedRowsForBook(bookKey);
      if (rows.length) {
        source = "imported";
      } else {
        rows = null;
      }
    }

    if (!rows) {
      const response = await fetch(`data/${encodeURIComponent(bookKey)}/content.json`);
      if (!response.ok) {
        throw new Error(`词书数据加载失败: ${bookKey}`);
      }
      rows = await response.json();
    }

    runtime.contentRows = rows;
    runtime.contentById = new Map(rows.map((row) => [row.id, row]));
    runtime.contentSource.set(bookKey, source);
  }

  // ---------- 启动 ----------
  let readyResolve;
  const ready = new Promise((resolve) => {
    readyResolve = resolve;
  });

  async function initialize() {
    runtime.db = await openDatabase();

    const storedBookKey = await storeGet(STORE_META, "current_book_key");
    runtime.progressById = new Map((await storeGetAll(STORE_PROGRESS)).map((row) => [row.id, row]));
    runtime.logs = await storeGetAll(STORE_LOGS);

    const response = await fetch("data/manifest.json");
    if (!response.ok) {
      throw new Error("词书清单加载失败");
    }
    const manifest = await response.json();
    runtime.manifest = manifest.books || [];

    runtime.currentBookKey = String(typeof storedBookKey === "string" ? storedBookKey : "").toUpperCase();
    if (!manifestBook(runtime.currentBookKey)) {
      runtime.currentBookKey = runtime.manifest[0]?.key || null;
    }

    if (runtime.currentBookKey) {
      await loadContentForBook(runtime.currentBookKey);
    }

    readyResolve();
  }

  // ---------- API 实现 ----------
  async function getStats(dayStartHour = 0) {
    await ready;
    const bookKey = runtime.currentBookKey;
    const todayStart = getStudyDayStart(new Date(), dayStartHour);
    const tomorrowStartIso = addDaysToDate(todayStart, 1).toISOString();
    const todayStartIso = todayStart.toISOString();

    const recentLogs = new Set();
    const todayNew = new Set();
    const todayReview = new Set();
    runtime.logs.forEach((log) => {
      if (log.book_key !== bookKey || log.replaced_by_log_id) {
        return;
      }
      if (log.studied_at >= todayStartIso && log.studied_at < tomorrowStartIso) {
        recentLogs.add(log.word_entry_id);
        if (log.session_type === "new") {
          todayNew.add(log.word_entry_id);
        } else if (log.session_type === "review") {
          todayReview.add(log.word_entry_id);
        }
      }
    });

    let learnedTotal = 0;
    let dueWords = 0;
    let masteredWords = 0;
    let newWords = 0;
    runtime.progressById.forEach((row) => {
      if (row.book_key !== bookKey) {
        return;
      }
      if (row.last_review_at) {
        learnedTotal += 1;
      } else {
        newWords += 1;
      }
      if (row.last_review_at && row.next_review_at && row.next_review_at < tomorrowStartIso) {
        dueWords += 1;
      }
      if (row.stage >= INTERVALS_MS.length - 1) {
        masteredWords += 1;
      }
    });

    const book = manifestBook(bookKey);
    if (book) {
      newWords = Math.max(book.total_words - learnedTotal, 0);
    }

    return {
      total_words: book?.total_words || runtime.contentRows.length,
      current_book: bookKey,
      current_book_title: book?.title || bookKey,
      learned_words: recentLogs.size,
      learned_words_total: learnedTotal,
      new_words: newWords,
      due_words: dueWords,
      mastered_words: masteredWords,
      today_new_words: todayNew.size,
      today_review_words: todayReview.size
    };
  }

  async function getStudyActivity(dayStartHour = 0) {
    await ready;
    const hour = normalizeDayStartHour(dayStartHour);
    const grouped = new Map();

    runtime.logs.forEach((log) => {
      if (log.book_key !== runtime.currentBookKey || log.replaced_by_log_id) {
        return;
      }
      const shifted = new Date(new Date(log.studied_at).getTime() - hour * 60 * 60 * 1000);
      const day = formatLocalDateKey(shifted);
      const bucket = grouped.get(day) || {
        date: day,
        new_words: new Set(),
        review_words: new Set(),
        study_words: new Set()
      };
      bucket.study_words.add(log.word_entry_id);
      if (log.session_type === "new") {
        bucket.new_words.add(log.word_entry_id);
      } else if (log.session_type === "review") {
        bucket.review_words.add(log.word_entry_id);
      }
      grouped.set(day, bucket);
    });

    return [...grouped.values()]
      .sort((left, right) => left.date.localeCompare(right.date))
      .map((bucket) => ({
        date: bucket.date,
        new_words: bucket.new_words.size,
        review_words: bucket.review_words.size,
        study_words: bucket.study_words.size
      }));
  }

  async function getTodayTasks(limit = 30) {
    await ready;
    const safeLimit = Math.min(Math.max(Number(limit) || 30, 1), 200);
    const nowIso = new Date().toISOString();
    const bookKey = runtime.currentBookKey;

    const reviewRows = [];
    const newRows = [];
    runtime.contentRows.forEach((row) => {
      const progress = runtime.progressById.get(row.id);
      if (progress?.last_review_at) {
        if (progress.next_review_at && progress.next_review_at <= nowIso) {
          reviewRows.push(row);
        }
      } else {
        newRows.push(row);
      }
    });

    reviewRows.sort((left, right) => {
      const leftAt = runtime.progressById.get(left.id)?.next_review_at || "";
      const rightAt = runtime.progressById.get(right.id)?.next_review_at || "";
      return leftAt.localeCompare(rightAt);
    });
    const limitedReviews = reviewRows.slice(0, safeLimit);
    const newNeeded = Math.max(safeLimit - limitedReviews.length, 0);
    const limitedNews = shuffle(newRows).slice(0, newNeeded);

    const items = shuffle([...limitedReviews, ...limitedNews]).map(wordToTask);
    return {
      items,
      total: items.length,
      review_count: limitedReviews.length,
      new_count: limitedNews.length
    };
  }

  async function getDueProjection(days = 90, dayStartHour = 0) {
    await ready;
    const totalDays = Math.min(Math.max(Number(days) || 90, 1), 365);
    const today = getStudyDayStart(new Date(), dayStartHour);
    const horizonEnd = addDaysToDate(today, totalDays - 1);
    const projectionMap = new Map();

    const addProjection = (date) => {
      if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
        return;
      }
      const clampedDate = date < today ? new Date(today) : date;
      if (clampedDate > horizonEnd) {
        return;
      }
      const key = formatStudyDateKey(clampedDate, dayStartHour);
      projectionMap.set(key, (projectionMap.get(key) || 0) + 1);
    };

    runtime.progressById.forEach((row) => {
      if (row.book_key !== runtime.currentBookKey || !row.last_review_at || !row.next_review_at) {
        return;
      }
      const stage = Math.min(Math.max(Number(row.stage) || 0, 0), INTERVALS_MS.length - 1);
      const lastReviewAt = new Date(row.last_review_at);
      const nextReviewAt = new Date(row.next_review_at);

      if (!nextReviewAt || Number.isNaN(nextReviewAt.getTime())) {
        return;
      }
      addProjection(nextReviewAt);
      if (!lastReviewAt || Number.isNaN(lastReviewAt.getTime())) {
        return;
      }
      for (let futureStage = stage + 1; futureStage < INTERVALS_MS.length; futureStage += 1) {
        addProjection(new Date(lastReviewAt.getTime() + INTERVALS_MS[futureStage]));
      }
    });

    const result = [];
    for (let offset = 0; offset < totalDays; offset += 1) {
      const date = addDaysToDate(today, offset);
      const key = formatLocalDateKey(date);
      result.push({
        date: key,
        count: projectionMap.get(key) || 0
      });
    }
    return result;
  }

  async function listBooks() {
    await ready;
    const currentKey = runtime.currentBookKey;
    return runtime.manifest
      .map((book) => {
        const summary = bookSummary(book.key);
        return { ...summary, is_current: book.key === currentKey };
      })
      .sort((left, right) => left.key.localeCompare(right.key));
  }

  async function getCurrentBook() {
    await ready;
    const summary = bookSummary(runtime.currentBookKey);
    if (!summary) {
      return null;
    }
    const { is_current: _ignored, ...rest } = summary;
    return rest;
  }

  async function switchBook(bookKey) {
    await ready;
    const normalized = String(bookKey || "").toUpperCase();
    if (!manifestBook(normalized)) {
      throw new Error(`未找到词书: ${bookKey}`);
    }

    if (normalized !== runtime.currentBookKey) {
      await loadContentForBook(normalized);
      runtime.currentBookKey = normalized;
    }
    await storePut(STORE_META, normalized, "current_book_key");
    return getCurrentBook();
  }

  async function updateStatus(wordId, action, replaceReviewLogId = null) {
    await ready;
    const row = runtime.contentById.get(wordId);
    if (!row) {
      throw new Error("单词不存在");
    }

    const stored = progressByIdGet(wordId);
    const previousState = stored
      ? {
          stage: stored.stage,
          last_review_at: stored.last_review_at,
          next_review_at: stored.next_review_at,
          review_count: stored.review_count,
          wrong_count: stored.wrong_count
        }
      : { stage: 0, last_review_at: null, next_review_at: null, review_count: 0, wrong_count: 0 };

    let sessionType = !previousState.last_review_at ? "new" : "review";
    let previousForLog = { ...previousState };

    if (replaceReviewLogId) {
      const previousLog = runtime.logs.find(
        (log) => log.id === replaceReviewLogId && log.word_entry_id === wordId
      );
      if (!previousLog) {
        throw new Error("找不到需要覆盖的学习记录");
      }
      previousForLog = {
        stage: previousLog.previous_stage ?? 0,
        last_review_at: previousLog.previous_last_review_at ?? null,
        next_review_at: previousLog.previous_next_review_at ?? null,
        review_count: previousLog.previous_review_count ?? 0,
        wrong_count: previousLog.previous_wrong_count ?? 0
      };
      sessionType = previousLog.session_type || (!previousForLog.last_review_at ? "new" : "review");
    }

    const isNewWord = sessionType === "new";
    const { newStage, wrongIncrement, nextReviewAt } = computeNextReview(previousForLog.stage, action, isNewWord);
    const reviewedAt = new Date().toISOString();

    const progressRow = {
      id: wordId,
      book_key: row.book_key,
      stage: newStage,
      last_review_at: reviewedAt,
      next_review_at: nextReviewAt,
      review_count: previousForLog.review_count + 1,
      wrong_count: previousForLog.wrong_count + wrongIncrement
    };
    await storePut(STORE_PROGRESS, progressRow);
    runtime.progressById.set(wordId, progressRow);

    const logRow = {
      word_entry_id: wordId,
      book_key: row.book_key,
      studied_at: reviewedAt,
      session_type: sessionType,
      action,
      previous_stage: previousForLog.stage,
      previous_last_review_at: previousForLog.last_review_at,
      previous_next_review_at: previousForLog.next_review_at,
      previous_review_count: previousForLog.review_count,
      previous_wrong_count: previousForLog.wrong_count,
      stage_after: newStage,
      replaced_by_log_id: null,
      created_at: reviewedAt
    };
    const newLogId = await requestToPromise(tx(STORE_LOGS, "readwrite").add(logRow));
    logRow.id = newLogId;
    runtime.logs.push(logRow);

    if (replaceReviewLogId) {
      const previousLog = runtime.logs.find((log) => log.id === replaceReviewLogId);
      if (previousLog) {
        previousLog.replaced_by_log_id = newLogId;
        const storedLog = await storeGet(STORE_LOGS, replaceReviewLogId);
        if (storedLog) {
          storedLog.replaced_by_log_id = newLogId;
          await storePut(STORE_LOGS, storedLog);
        }
      }
    }

    return {
      ok: true,
      stage: newStage,
      next_review_at: nextReviewAt,
      task_type: sessionType,
      review_log_id: newLogId
    };
  }

  async function getAboutContent() {
    const response = await fetch("docs/about.md");
    return response.text();
  }

  async function getGuideContent() {
    const response = await fetch("docs/guide.md");
    return response.text();
  }

  async function getWindowState() {
    return {
      isFullScreen: Boolean(document.fullscreenElement),
      isMaximized: false
    };
  }

  async function showWindow() {
    return { ok: true };
  }

  async function toggleFullScreen() {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
        return { isFullScreen: true };
      }
      await document.exitFullscreen();
      return { isFullScreen: false };
    } catch {
      return { isFullScreen: Boolean(document.fullscreenElement) };
    }
  }

  function downloadJson(payload, filename) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  async function loadAllContentRows() {
    const imported = await storeGetAll(STORE_IMPORTED);
    const importedByKey = new Map();
    imported.forEach((row) => {
      const bucket = importedByKey.get(row.book_key) || [];
      bucket.push(row);
      importedByKey.set(row.book_key, bucket);
    });

    const allRows = [];
    for (const book of runtime.manifest) {
      if (importedByKey.has(book.key)) {
        allRows.push(...importedByKey.get(book.key));
        continue;
      }
      if (book.key === runtime.currentBookKey) {
        allRows.push(...runtime.contentRows);
        continue;
      }
      const response = await fetch(`data/${encodeURIComponent(book.key)}/content.json`);
      if (!response.ok) {
        throw new Error(`词书数据加载失败: ${book.key}`);
      }
      allRows.push(...(await response.json()));
    }
    return allRows;
  }

  function contentRowToExport(row, progress) {
    const now = new Date().toISOString();
    return {
      id: row.id,
      book_key: row.book_key,
      word: row.word,
      word_id: row.word_id || "",
      source_book_id: row.source_book_id || "",
      phonetic_uk: row.phonetic_uk || "",
      phonetic_us: row.phonetic_us || "",
      speech_uk: row.speech_uk || "",
      speech_us: row.speech_us || "",
      examples_json: JSON.stringify(row.examples || []),
      meanings_json: JSON.stringify(row.meanings || []),
      translation_summary: row.translation_summary || "",
      stage: progress?.stage ?? 0,
      last_review_at: progress?.last_review_at ?? null,
      next_review_at: progress?.next_review_at ?? null,
      review_count: progress?.review_count ?? 0,
      wrong_count: progress?.wrong_count ?? 0,
      created_at: row.created_at || now,
      updated_at: progress?.last_review_at || row.updated_at || now
    };
  }

  async function exportData() {
    await ready;
    const timestamp = new Date().toISOString().replace(/:/g, "-").replace(/\..+$/, "");
    const filename = `engram-backup-${timestamp}.json`;

    const allRows = await loadAllContentRows();
    const words = allRows
      .map((row) => contentRowToExport(row, runtime.progressById.get(row.id)))
      .sort((left, right) => left.id - right.id);

    const books = runtime.manifest.map((book, index) => ({
      id: index + 1,
      book_key: book.key,
      title: book.title,
      source_type: "builtin",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }));

    const payload = {
      schema_version: 3,
      app_version: APP_VERSION,
      exported_at: new Date().toISOString(),
      current_book_key: runtime.currentBookKey,
      books,
      words,
      review_logs: [...runtime.logs].sort((left, right) => left.id - right.id),
      app_meta: [
        { key: "current_book_key", value: runtime.currentBookKey || "" },
        { key: "schema_version", value: "3" }
      ]
    };

    downloadJson(payload, filename);
    return { canceled: false, filePath: `浏览器下载：${filename}` };
  }

  async function pickImportFile() {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "application/json,.json";
      input.onchange = () => resolve(input.files?.[0] || null);
      input.oncancel = () => resolve(null);
      input.click();
    });
  }

  async function importData() {
    await ready;
    const file = await pickImportFile();
    if (!file) {
      return { canceled: true };
    }

    const text = await file.text();
    const payload = JSON.parse(text);
    if (!payload || typeof payload !== "object" || !Array.isArray(payload.books)
      || !Array.isArray(payload.words) || !Array.isArray(payload.review_logs)) {
      throw new Error("导入文件缺少必要的数据表");
    }

    const importedRows = [];
    const progressRows = [];
    payload.words.forEach((row) => {
      const wordId = Number(row.id);
      if (!Number.isFinite(wordId)) {
        return;
      }
      const bookKey = String(row.book_key || "").toUpperCase();
      importedRows.push({
        id: wordId,
        book_key: bookKey,
        word: row.word,
        word_id: row.word_id || "",
        source_book_id: row.source_book_id || "",
        phonetic_uk: row.phonetic_uk || "",
        phonetic_us: row.phonetic_us || "",
        speech_uk: row.speech_uk || "",
        speech_us: row.speech_us || "",
        examples: JSON.parse(row.examples_json || "[]"),
        meanings: JSON.parse(row.meanings_json || "[]"),
        translation_summary: row.translation_summary || "",
        created_at: row.created_at,
        updated_at: row.updated_at
      });
      progressRows.push({
        id: wordId,
        book_key: bookKey,
        stage: Number(row.stage) || 0,
        last_review_at: row.last_review_at || null,
        next_review_at: row.next_review_at || null,
        review_count: Number(row.review_count) || 0,
        wrong_count: Number(row.wrong_count) || 0
      });
    });

    const logRows = payload.review_logs.map((row) => ({
      id: Number(row.id),
      word_entry_id: Number(row.word_entry_id),
      book_key: String(row.book_key || "").toUpperCase(),
      studied_at: row.studied_at,
      session_type: row.session_type,
      action: row.action,
      previous_stage: Number(row.previous_stage) || 0,
      previous_last_review_at: row.previous_last_review_at || null,
      previous_next_review_at: row.previous_next_review_at || null,
      previous_review_count: Number(row.previous_review_count) || 0,
      previous_wrong_count: Number(row.previous_wrong_count) || 0,
      stage_after: Number(row.stage_after) || 0,
      replaced_by_log_id: row.replaced_by_log_id ?? null,
      created_at: row.created_at || row.studied_at
    })).filter((row) => Number.isFinite(row.id) && Number.isFinite(row.word_entry_id));

    await storeClear(STORE_META);
    await storeClear(STORE_PROGRESS);
    await storeClear(STORE_LOGS);
    await storeClear(STORE_IMPORTED);

    await storePutAll(STORE_IMPORTED, importedRows);
    await storePutAll(STORE_PROGRESS, progressRows);
    await storePutAll(STORE_LOGS, logRows);

    const metaValues = Array.isArray(payload.app_meta) && payload.app_meta.length
      ? payload.app_meta.filter((row) => row && row.key && row.key !== "schema_version")
      : [{ key: "current_book_key", value: String(payload.current_book_key || "").toUpperCase() }];
    for (const row of metaValues) {
      await storePut(STORE_META, String(row.value ?? ""), row.key);
    }

    runtime.progressById = new Map(progressRows.map((row) => [row.id, row]));
    runtime.logs = logRows;
    runtime.currentBookKey = String(payload.current_book_key || "").toUpperCase();
    if (!manifestBook(runtime.currentBookKey)) {
      runtime.currentBookKey = runtime.manifest[0]?.key || null;
    }
    if (runtime.currentBookKey) {
      await loadContentForBook(runtime.currentBookKey);
    }

    return {
      canceled: false,
      filePath: file.name,
      words: importedRows.length,
      review_logs: logRows.length
    };
  }

  async function getAppInfo() {
    return { version: `${APP_VERSION} (web)`, isPackaged: false };
  }

  window.engramAPI = {
    getStats,
    getStudyActivity,
    getTodayTasks,
    getDueProjection,
    listBooks,
    getCurrentBook,
    switchBook,
    updateStatus,
    getAboutContent,
    getGuideContent,
    getWindowState,
    showWindow,
    toggleFullScreen,
    exportData,
    importData,
    getAppInfo
  };

  initialize().catch((error) => {
    console.error("Engram 网页版初始化失败", error);
  });
})();
