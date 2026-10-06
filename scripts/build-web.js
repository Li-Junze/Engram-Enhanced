#!/usr/bin/env node
// 构建浏览器版（web-dist）词书数据：
// 复用与 electron/store.js 一致的规范化管线，保证单词 id 与桌面版数据库一一对应。
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const OUT_DIR = path.join(ROOT, "web-dist");

const BUILTIN_BOOK_TITLES = {
  CET4: "大学英语四级",
  CET6: "大学英语六级",
  KAOYAN: "考研词汇",
  IELTS: "雅思词汇",
  TOEFL: "托福词汇"
};

function splitDefinitions(text) {
  return String(text || "")
    .split(/[;；、/]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizePos(pos) {
  return String(pos || "").trim() || "未分类";
}

function addMeaning(map, pos, text) {
  const definitions = splitDefinitions(text);
  if (!definitions.length) {
    return;
  }

  const normalizedPos = normalizePos(pos);
  const bucket = map.get(normalizedPos) || new Set();
  definitions.forEach((definition) => bucket.add(definition));
  map.set(normalizedPos, bucket);
}

function mergeMeanings(target, source) {
  const merged = new Map();

  [...target, ...source].forEach((entry) => {
    const bucket = merged.get(entry.pos) || new Set();
    (entry.definitions || []).forEach((definition) => bucket.add(definition));
    merged.set(entry.pos, bucket);
  });

  return Array.from(merged.entries()).map(([pos, definitions]) => ({
    pos,
    definitions: [...definitions]
  }));
}

function mergeExamples(target, source) {
  const seen = new Set();
  const merged = [];

  [...(target || []), ...(source || [])].forEach((entry) => {
    const english = String(entry?.english || "").trim();
    const chinese = String(entry?.chinese || "").trim();
    const speech = String(entry?.speech || "").trim();
    if (!english) {
      return;
    }

    const key = `${english}\n${chinese}`.toLowerCase();
    if (seen.has(key)) {
      if (speech) {
        const existing = merged.find((item) => `${item.english}\n${item.chinese}`.toLowerCase() === key);
        if (existing && !existing.speech) {
          existing.speech = speech;
        }
      }
      return;
    }

    seen.add(key);
    merged.push({ english, chinese, speech });
  });

  return merged;
}

function buildTranslationSummary(meanings) {
  return meanings
    .map((entry) => `${entry.pos} ${entry.definitions.join("；")}`.trim())
    .join(" / ");
}

function extractExamples(content) {
  const sentences = content?.sentence?.sentences || [];
  return mergeExamples([], sentences.map((entry) => ({
    english: entry.sContent || entry.sContent_eng || "",
    chinese: entry.sCn || "",
    speech: entry.sSpeech || ""
  })));
}

function extractRecord(item, bookKey) {
  const wordRoot = item?.content?.word || {};
  const content = wordRoot.content || {};
  const transEntries = content.trans || [];
  const synoEntries = content.syno?.synos || [];
  const meaningMap = new Map();

  transEntries.forEach((entry) => {
    addMeaning(meaningMap, entry.pos, entry.tranCn);
  });

  synoEntries.forEach((entry) => {
    addMeaning(meaningMap, entry.pos, entry.tran);
  });

  const meanings = Array.from(meaningMap.entries()).map(([pos, definitions]) => ({
    pos,
    definitions: [...definitions]
  }));

  return {
    book_key: bookKey,
    word: String(item?.headWord || "").trim(),
    word_id: String(wordRoot.wordId || "").trim(),
    source_book_id: String(item?.bookId || "").trim(),
    phonetic_uk: content.ukphone || "",
    phonetic_us: content.usphone || "",
    speech_uk: content.ukspeech || "",
    speech_us: content.usspeech || "",
    examples: extractExamples(content),
    meanings,
    translation_summary: buildTranslationSummary(meanings)
  };
}

function recordScore(record) {
  return [
    record.phonetic_uk,
    record.phonetic_us,
    record.speech_uk,
    record.speech_us,
    record.translation_summary,
    ...(record.examples || []).map((entry) => entry.english),
    ...(record.meanings || []).flatMap((entry) => entry.definitions || [])
  ].filter(Boolean).length;
}

function mergeRecords(baseRecord, nextRecord) {
  const preferred = recordScore(nextRecord) > recordScore(baseRecord) ? nextRecord : baseRecord;
  const fallback = preferred === baseRecord ? nextRecord : baseRecord;
  const meanings = mergeMeanings(baseRecord.meanings || [], nextRecord.meanings || []);

  return {
    book_key: preferred.book_key,
    word: preferred.word,
    word_id: preferred.word_id || fallback.word_id,
    source_book_id: preferred.source_book_id || fallback.source_book_id,
    phonetic_uk: preferred.phonetic_uk || fallback.phonetic_uk,
    phonetic_us: preferred.phonetic_us || fallback.phonetic_us,
    speech_uk: preferred.speech_uk || fallback.speech_uk,
    speech_us: preferred.speech_us || fallback.speech_us,
    examples: mergeExamples(baseRecord.examples, nextRecord.examples),
    meanings,
    translation_summary: buildTranslationSummary(meanings)
  };
}

function normalizeBookTitle(bookKey) {
  return BUILTIN_BOOK_TITLES[bookKey] || bookKey;
}

function discoverBooks(dataDir) {
  const entries = fs.readdirSync(dataDir, { withFileTypes: true });
  const groups = new Map();

  entries.forEach((entry) => {
    if (entry.isFile() && entry.name.toLowerCase().endsWith(".json")) {
      const match = /^([A-Za-z0-9]+)_\d+\.json$/i.exec(entry.name);
      if (!match) {
        return;
      }
      const bookKey = match[1].toUpperCase();
      const files = groups.get(bookKey) || [];
      files.push(path.join(dataDir, entry.name));
      groups.set(bookKey, files);
      return;
    }

    if (!entry.isDirectory()) {
      return;
    }

    const dirPath = path.join(dataDir, entry.name);
    const files = fs.readdirSync(dirPath)
      .filter((name) => name.toLowerCase().endsWith(".json") && name.toLowerCase() !== "manifest.json")
      .map((name) => path.join(dirPath, name));

    if (!files.length) {
      return;
    }

    const bookKey = entry.name.toUpperCase();
    groups.set(bookKey, [...(groups.get(bookKey) || []), ...files]);
  });

  return [...groups.entries()]
    .map(([bookKey, files]) => ({
      key: bookKey,
      title: normalizeBookTitle(bookKey),
      files: files.sort()
    }))
    .sort((left, right) => left.key.localeCompare(right.key));
}

function loadEntriesForBook(book) {
  const recordsByWord = new Map();

  book.files.forEach((filePath) => {
    const items = JSON.parse(fs.readFileSync(filePath, "utf8"));
    items.forEach((item) => {
      const record = extractRecord(item, book.key);
      if (!record.word) {
        return;
      }

      const key = record.word.toLowerCase();
      if (!recordsByWord.has(key)) {
        recordsByWord.set(key, record);
        return;
      }

      recordsByWord.set(key, mergeRecords(recordsByWord.get(key), record));
    });
  });

  return [...recordsByWord.values()];
}

function main() {
  const books = discoverBooks(DATA_DIR);
  if (!books.length) {
    throw new Error(`未在 ${DATA_DIR} 中找到可用词书数据`);
  }

  fs.rmSync(path.join(OUT_DIR, "data"), { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT_DIR, "data"), { recursive: true });

  const manifest = [];
  let nextId = 1;

  books.forEach((book) => {
    const entries = loadEntriesForBook(book);
    const rows = entries.map((record) => ({
      id: nextId++,
      book_key: record.book_key,
      word: record.word,
      word_id: record.word_id,
      source_book_id: record.source_book_id,
      phonetic_uk: record.phonetic_uk,
      phonetic_us: record.phonetic_us,
      speech_uk: record.speech_uk,
      speech_us: record.speech_us,
      examples: record.examples,
      meanings: record.meanings,
      translation_summary: record.translation_summary
    }));

    const bookDir = path.join(OUT_DIR, "data", book.key);
    fs.mkdirSync(bookDir, { recursive: true });
    fs.writeFileSync(path.join(bookDir, "content.json"), JSON.stringify(rows));

    manifest.push({
      key: book.key,
      title: book.title,
      total_words: rows.length
    });
    console.log(`${book.key}: ${rows.length} 词 -> data/${book.key}/content.json`);
  });

  fs.writeFileSync(path.join(OUT_DIR, "data", "manifest.json"), JSON.stringify({
    generated_at: new Date().toISOString(),
    books: manifest
  }, null, 2));

  console.log(`共 ${nextId - 1} 词，manifest 已写入 web-dist/data/manifest.json`);
}

main();
