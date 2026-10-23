// Reading Claude's answer aloud on the phone, its logic kept out of the page so the plugin's tests
// run it: the answer's markdown as words to say, and those words cut into pieces, each read by the
// Vietnamese voice or the English one. The page loads it as a module and reads it from globalThis.Speak.

// A letter only Vietnamese writes: a vowel with a mark, or đ
const VI_LETTER = /[àáảãạăằắẳẵặâầấẩẫậđèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵ]/i
// Vietnamese words written with no mark, which English would claim: they take their neighbours'
// language instead
const VI_PLAIN = new Set(`ai anh ba bao bay bi binh ca cai cam can cao chi chia chin cho chung con cu
  da dai dan dang danh dao day di dinh du em gi gia giao hai hay hoa hoan hoang hon huy kia khi khoa
  khoan khong khung la lam lan lang lao le linh long mai man mang may minh mo mua na nam nay ngan
  nghe nghi ngoai ngon nguy nhanh nhau nho nhung no ninh oi pha phai phan phi qua quan quanh que sang
  sao sau sinh so sung ta tai tam tan tang tao thanh than thao the thi thoi thu tin tinh to toan tra
  trang tranh trong trung tu tuan tung tuy va vai van vang vao vay vi vinh vui xa xanh xe xem xin xong
  xuan xung`.split(/\s+/))
// English words in a row it takes, inside a Vietnamese sentence, for the English voice to read them;
// fewer stay with the Vietnamese voice, which says "fix bug" or "merge" as people do
export const EN_RUN = 3

// The words to say for an answer in markdown: a code block named, not read; a link its text; a path
// its file name; the marks of bold, headings, lists and tables gone. Lines stay lines.
export function speechText(md) {
  return md
    .replace(/(^|\n)(`{3,}|~{3,})[^\n]*\n[\s\S]*?(\n\2[^\n]*|$)/g, '$1Code block.\n')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, 'link')
    .replace(/`([^`\n]*)`/g, (_m, code) => (code.length > 40 ? 'code' : code))
    .replace(/(?:[\w.@~-]+\/)+([\w.-]+)/g, '$1')
    .replace(/^\s*\|?[\s:|-]+\|[\s:|-]*$/gm, '')
    .replace(/[ \t]*\|[ \t]*/g, ', ')
    .replace(/^\s{0,3}(?:#{1,6}|>|[-*+]|\d+[.)])\s+/gm, '')
    .replace(/(\*\*|__|~~|\*|_)(\S(?:[^\n]*?\S)?)\1/g, '$2')
    .replace(/\s*(?:→|->|=>)\s*/g, ', ')
    .replace(/^[, ]+|[, ]+$/gm, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim()
}

// A word's language: vi with a Vietnamese mark, en in plain letters, null when it goes either way
// (a Vietnamese word with no mark, a number, a file name, a symbol)
function langOf(word) {
  const core = word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
  if (VI_LETTER.test(core)) return 'vi'
  if (!/^[a-z]+(?:['’][a-z]+)?$/i.test(core) || VI_PLAIN.has(core.toLowerCase())) return null
  return 'en'
}

// One sentence's words, each given a language: a sentence with no Vietnamese word is English
// whole; in one with some, a word that goes either way is English only between English words, and
// English words fewer than EN_RUN in a row are read in Vietnamese.
function sentenceLangs(words) {
  const langs = words.map(langOf)
  if (!langs.includes('vi')) return langs.map(() => 'en')
  const near = (i, step) => {
    for (let j = i + step; j >= 0 && j < langs.length; j += step) if (langs[j]) return langs[j]
    return 'en'
  }
  const filled = langs.map((l, i) => l ?? (near(i, -1) === 'en' && near(i, 1) === 'en' ? 'en' : 'vi'))
  for (let i = 0; i < filled.length; ) {
    let j = i
    while (j < filled.length && filled[j] === filled[i]) j++
    if (filled[i] === 'en' && words.slice(i, j).filter((_w, k) => langs[i + k] === 'en').length < EN_RUN) filled.fill('vi', i, j)
    i = j
  }
  return filled
}

// The answer in pieces to read one after another, each with its language: a sentence at a time,
// and a sentence cut where its language changes.
export function segments(text) {
  const out = []
  for (const sentence of text.split(/\n+|(?<=[.!?…])\s+/)) {
    const words = sentence.split(/\s+/).filter(Boolean)
    if (!words.length) continue
    const langs = sentenceLangs(words)
    let from = 0
    for (let i = 1; i <= words.length; i++) {
      if (i < words.length && langs[i] === langs[from]) continue
      out.push({ lang: langs[from], text: words.slice(from, i).join(' ') })
      from = i
    }
  }
  return out
}

globalThis.Speak = { speechText, segments, EN_RUN }
