// FR-064: 同梱の SVG 部品（アニメ調で統一した汎用の物体）・語の辞書・実在人物を特定しない汎用キャラのビルダー。
// すべて決定的・外部通信なし。部品は部品キー（例: 'book-note'）で引ける（getPart / getPartInfo / getPartKeys）。
// 後続の LLM 抽出（FR-063）は、抽出結果のキーを isPartKey で検証して部品に対応づける。
// 部品の SVG は許可リスト（isAllowedPartSvg）を通る図形だけで書き、外部への参照を持たない（NFR-SEC-004 の検査と同じ規則）。
import { detectEmotions, EMOTIONS } from './emotion.js';

const INK = '#15191f';
const HI = '<path d="M11 14q2-3 5-3" fill="none" stroke="#ffffff" stroke-opacity="0.75" stroke-width="2" stroke-linecap="round"/>';

// 48x48 の枠に収まる輪郭。a = 主な色、b = 差し色。線は太く、面は平塗り＋白いハイライト（アニメ調）。
const SIL = {
  box: (a, b) => `<path d="M6 16l18-8 18 8v20l-18 8-18-8z" fill="${a}"/><path d="M6 16l18 8 18-8M24 24v20" fill="none"/><path d="M15 12l18 8" stroke="${b}"/>`,
  book: (a, b) => `<path d="M8 8h26a4 4 0 0 1 4 4v28H12a4 4 0 0 1-4-4z" fill="${a}"/><path d="M8 36a4 4 0 0 1 4-4h26" fill="none"/><path d="M15 15h14M15 21h10" stroke="${b}"/>`,
  cup: (a, b) => `<path d="M9 14h24v14a10 10 0 0 1-10 10h-4A10 10 0 0 1 9 28z" fill="${a}"/><path d="M33 17h3a5 5 0 0 1 0 10h-3" fill="none"/><path d="M15 6q-2 3 0 5M23 6q-2 3 0 5" stroke="${b}" fill="none"/>`,
  house: (a, b) => `<path d="M8 22L24 7l16 15v18H8z" fill="${a}"/><path d="M20 40V28h8v12z" fill="${b}"/>`,
  tree: (a, b) => `<path d="M21 30h6v12h-6z" fill="${b}"/><circle cx="24" cy="20" r="13" fill="${a}"/>`,
  cloud: (a, b) => `<path d="M12 34a8 8 0 0 1-1-16 11 11 0 0 1 21-2 9 9 0 0 1 2 18z" fill="${a}"/><path d="M16 38v4M24 38v4M32 38v4" stroke="${b}" fill="none"/>`,
  star: (a) => `<path d="M24 5l5.500 12 13 1.500-9.500 9 2.500 13L24 34l-11.500 6.500 2.500-13-9.500-9 13-1.500z" fill="${a}"/>`,
  heart: (a) => `<path d="M24 41C8 29 6 20 11 14a9 9 0 0 1 13 2 9 9 0 0 1 13-2c5 6 3 15-13 27z" fill="${a}"/>`,
  gear: (a, b) => `<path d="M21 5h6l1 5 4 2 4-3 4 4-3 4 2 4 5 1v6l-5 1-2 4 3 4-4 4-4-3-4 2-1 5h-6l-1-5-4-2-4 3-4-4 3-4-2-4-5-1v-6l5-1 2-4-3-4 4-4 4 3 4-2z" fill="${a}"/><circle cx="24" cy="24" r="6" fill="${b}"/>`,
  flag: (a, b) => `<path d="M10 6v37" fill="none"/><path d="M10 8h28l-6 8 6 8H10z" fill="${a}"/><circle cx="10" cy="43" r="2" fill="${b}"/>`,
  key: (a, b) => `<circle cx="14" cy="18" r="9" fill="${a}"/><circle cx="14" cy="18" r="3" fill="${b}"/><path d="M21 24l20 18M33 36l5-5M37 40l4-4" fill="none"/>`,
  bell: (a, b) => `<path d="M24 6a12 12 0 0 1 12 12v10l4 6H8l4-6V18A12 12 0 0 1 24 6z" fill="${a}"/><path d="M19 38a5 5 0 0 0 10 0z" fill="${b}"/>`,
  clock: (a, b) => `<circle cx="24" cy="24" r="18" fill="${a}"/><path d="M24 12v12l8 5" fill="none" stroke="${b}"/>`,
  phone: (a, b) => `<rect x="14" y="5" width="20" height="38" rx="5" fill="${a}"/><rect x="18" y="10" width="12" height="22" rx="1" fill="${b}"/><circle cx="24" cy="38" r="2" fill="${b}"/>`,
  monitor: (a, b) => `<rect x="5" y="8" width="38" height="24" rx="3" fill="${a}"/><path d="M24 32v8M15 41h18" fill="none"/><path d="M11 15h18M11 21h12" stroke="${b}" fill="none"/>`,
  bag: (a, b) => `<path d="M10 18h28l2 24H8z" fill="${a}"/><path d="M17 18v-4a7 7 0 0 1 14 0v4" fill="none"/><path d="M16 28h16" stroke="${b}" fill="none"/>`,
  bottle: (a, b) => `<path d="M20 5h8v8l5 7v20a3 3 0 0 1-3 3H18a3 3 0 0 1-3-3V20l5-7z" fill="${a}"/><path d="M15 28h18v8H15z" fill="${b}"/>`,
  car: (a, b) => `<path d="M5 30l4-10a4 4 0 0 1 4-3h22a4 4 0 0 1 4 3l4 10v7H5z" fill="${a}"/><circle cx="14" cy="37" r="5" fill="${b}"/><circle cx="34" cy="37" r="5" fill="${b}"/>`,
  bulb: (a, b) => `<path d="M24 5a13 13 0 0 0-7 24c1 1 2 3 2 5h10c0-2 1-4 2-5A13 13 0 0 0 24 5z" fill="${a}"/><path d="M19 39h10M20 43h8" stroke="${b}" fill="none"/>`,
  envelope: (a, b) => `<rect x="5" y="10" width="38" height="28" rx="3" fill="${a}"/><path d="M5 12l19 15 19-15" fill="none" stroke="${b}"/>`,
  document: (a, b) => `<path d="M10 4h20l9 9v31H10z" fill="${a}"/><path d="M30 4v9h9M16 22h16M16 29h16M16 36h10" fill="none" stroke="${b}"/>`,
  folder: (a, b) => `<path d="M4 12a3 3 0 0 1 3-3h12l4 5h18a3 3 0 0 1 3 3v22a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3z" fill="${a}"/><path d="M4 20h40" stroke="${b}" fill="none"/>`,
  chart: (a, b) => `<path d="M6 6v36h36" fill="none"/><path d="M12 36V26h6v10zM22 36V16h6v20zM32 36V22h6v14z" fill="${a}"/><path d="M12 18l10-6 10 4 8-8" stroke="${b}" fill="none"/>`,
  magnifier: (a, b) => `<circle cx="20" cy="20" r="13" fill="${a}"/><path d="M30 30l13 13" stroke="${b}" stroke-width="5" fill="none"/>`,
  lock: (a, b) => `<rect x="9" y="21" width="30" height="21" rx="4" fill="${a}"/><path d="M15 21v-6a9 9 0 0 1 18 0v6" fill="none"/><circle cx="24" cy="31" r="3" fill="${b}"/>`,
  pencil: (a, b) => `<path d="M8 40l3-10L33 8l7 7-22 22z" fill="${a}"/><path d="M8 40l3-10 7 7z" fill="${b}"/>`,
  rocket: (a, b) => `<path d="M24 4c8 6 10 16 8 26H16C14 20 16 10 24 4z" fill="${a}"/><circle cx="24" cy="18" r="4" fill="${b}"/><path d="M16 30l-6 8 8-2zM32 30l6 8-8-2z" fill="${b}"/>`,
  boat: (a, b) => `<path d="M24 5v24M24 7l14 18H24z" fill="${b}"/><path d="M6 30h36l-6 10H12z" fill="${a}"/>`,
  plane: (a, b) => `<path d="M42 8L6 22l12 5 5 12z" fill="${a}"/><path d="M18 27L42 8" stroke="${b}" fill="none"/>`,
  mountain: (a, b) => `<path d="M3 40L18 12l8 14 6-8 13 22z" fill="${a}"/><path d="M14 19l4-7 4 7-4-2z" fill="${b}"/>`,
  sun: (a, b) => `<circle cx="24" cy="24" r="10" fill="${a}"/><path d="M24 4v6M24 38v6M4 24h6M38 24h6M10 10l4 4M34 34l4 4M38 10l-4 4M14 34l-4 4" stroke="${b}" fill="none"/>`,
  moon: (a, b) => `<path d="M30 6a18 18 0 1 0 12 26A15 15 0 0 1 30 6z" fill="${a}"/><circle cx="14" cy="22" r="2" fill="${b}"/>`,
  coin: (a, b) => `<circle cx="24" cy="24" r="18" fill="${a}"/><circle cx="24" cy="24" r="12" fill="none" stroke="${b}"/><path d="M24 17v14M20 20h7M20 28h7" stroke="${b}" fill="none"/>`,
  gift: (a, b) => `<rect x="7" y="18" width="34" height="24" rx="2" fill="${a}"/><rect x="5" y="12" width="38" height="8" rx="2" fill="${b}"/><path d="M24 12v30M24 12c-6-8-12-3-8 0M24 12c6-8 12-3 8 0" fill="none"/>`,
  chair: (a, b) => `<path d="M14 6h20l-2 20H16z" fill="${a}"/><path d="M10 26h28v6H10zM14 32v11M34 32v11" fill="${b}"/>`,
  table: (a, b) => `<rect x="4" y="14" width="40" height="7" rx="2" fill="${a}"/><path d="M9 21v21M39 21v21" stroke="${b}" fill="none"/>`,
  camera: (a, b) => `<path d="M5 14h10l3-5h12l3 5h10v26H5z" fill="${a}"/><circle cx="24" cy="26" r="8" fill="${b}"/>`,
  headphone: (a, b) => `<path d="M8 28V24a16 16 0 0 1 32 0v4" fill="none"/><rect x="5" y="26" width="10" height="16" rx="4" fill="${a}"/><rect x="33" y="26" width="10" height="16" rx="4" fill="${a}"/><path d="M9 32h2" stroke="${b}" fill="none"/>`,
  trophy: (a, b) => `<path d="M14 6h20v14a10 10 0 0 1-20 0z" fill="${a}"/><path d="M14 10H6c0 8 4 11 9 11M34 10h8c0 8-4 11-9 11" fill="none"/><path d="M21 30h6v6h-6zM14 42h20v-6H14z" fill="${b}"/>`,
  umbrella: (a, b) => `<path d="M4 24a20 18 0 0 1 40 0z" fill="${a}"/><path d="M24 24v14a4 4 0 0 1-8 0" fill="none"/><path d="M14 24q2-8 6-17M34 24q-2-8-6-17" stroke="${b}" fill="none"/>`,
  puzzle: (a, b) => `<path d="M8 12h10a5 5 0 1 1 10 0h10v10a5 5 0 1 1 0 10v10H8z" fill="${a}"/><circle cx="16" cy="30" r="3" fill="${b}"/>`,
  people: (a, b) => `<circle cx="24" cy="15" r="7" fill="${a}"/><path d="M10 41a14 12 0 0 1 28 0z" fill="${a}"/><circle cx="38" cy="19" r="4" fill="${b}"/><circle cx="10" cy="19" r="4" fill="${b}"/>`,
  wrench: (a, b) => `<path d="M32 5a10 10 0 0 0-9 13L6 35a5 5 0 0 0 7 7l17-17a10 10 0 0 0 13-9l-7 5-6-2-2-6z" fill="${a}"/><circle cx="10" cy="38" r="2" fill="${b}"/>`,
  battery: (a, b) => `<rect x="4" y="15" width="36" height="18" rx="3" fill="${a}"/><rect x="40" y="21" width="4" height="6" fill="${b}"/><path d="M10 20v8M16 20v8M22 20v8" stroke="${b}" fill="none"/>`,
  ticket: (a, b) => `<path d="M4 14h40v7a3 3 0 0 0 0 6v7H4v-7a3 3 0 0 0 0-6z" fill="${a}"/><path d="M30 14v20" stroke="${b}" stroke-dasharray="3 3" fill="none"/>`,
};

// [シルエット, 部品キー, 日本語名, 英語名, 日本語の語[], 英語の語[], 主色, 差し色]
const DEFS = [
  ['box', 'box-parcel', '荷物', 'parcel', ['荷物', '段ボール', '小包'], ['parcel', 'package', 'cardboard'], '#e8c07d', '#b9822f'],
  ['box', 'box-delivery', '配送', 'delivery', ['配送', '宅配', '納品'], ['delivery', 'shipment', 'shipping'], '#f2d49b', '#d46a2c'],
  ['box', 'box-stock', '在庫', 'inventory', ['在庫', '倉庫'], ['inventory', 'warehouse', 'stock'], '#c9a46a', '#7a5a2a'],
  ['book', 'book-note', 'ノート', 'notebook', ['ノート', '手帳'], ['notebook', 'journal'], '#7ab8f5', '#ffffff'],
  ['book', 'book-manual', 'マニュアル', 'manual', ['マニュアル', '手順書', '説明書'], ['manual', 'handbook', 'guide'], '#f58a7a', '#ffffff'],
  ['book', 'book-dict', '辞書', 'dictionary', ['辞書', '辞典'], ['dictionary', 'glossary'], '#8fd19e', '#ffffff'],
  ['book', 'book-text', '本', 'book', ['本を', '本が', '書籍', '読書'], ['book', 'books', 'reading'], '#f5c542', '#ffffff'],
  ['cup', 'cup-coffee', 'コーヒー', 'coffee', ['コーヒー', '珈琲'], ['coffee', 'espresso'], '#f7f1e8', '#8a5a33'],
  ['cup', 'cup-tea', 'お茶', 'tea', ['お茶', '紅茶', '緑茶'], ['tea', 'teacup'], '#bfe3c4', '#4e9d62'],
  ['cup', 'cup-break', '休憩', 'break', ['休憩', 'ブレイク', '一息'], ['break time', 'coffee break', 'rest'], '#ffd6e0', '#d9648a'],
  ['house', 'house-home', '家', 'home', ['自宅', '家庭', '住まい', '実家'], ['home', 'house', 'residence'], '#f5a97f', '#8a4b2d'],
  ['house', 'house-office', '事務所', 'office', ['事務所', 'オフィス', '会社'], ['office', 'workplace', 'company'], '#a9c4e8', '#35557f'],
  ['house', 'house-shop', '店舗', 'shop', ['店舗', 'お店', '店'], ['shop', 'store', 'retail'], '#f7d77a', '#c2562b'],
  ['tree', 'tree-green', '木', 'tree', ['樹木', '森', '植樹'], ['tree', 'forest', 'woods'], '#7cc76f', '#8b5a2b'],
  ['tree', 'tree-autumn', '紅葉', 'autumn leaves', ['紅葉', '秋'], ['autumn', 'fall foliage'], '#f08a3c', '#7a4a2a'],
  ['tree', 'tree-growth', '成長', 'growth', ['成長', '育て'], ['growth', 'grow'], '#5fbf8a', '#7a5a33'],
  ['cloud', 'cloud-rain', '雨', 'rain', ['雨'], ['rain', 'rainy'], '#cfd9e6', '#3d78c9'],
  ['cloud', 'cloud-sky', '雲', 'cloud', ['雲', 'クラウド'], ['cloud', 'cloudy'], '#eef3fa', '#9fb4cc'],
  ['cloud', 'cloud-storm', '嵐', 'storm', ['嵐', '台風', '雷雨'], ['storm', 'typhoon', 'thunderstorm'], '#a9b4c4', '#f2c230'],
  ['star', 'star-gold', '星', 'star', ['星', 'スター'], ['star', 'stars'], '#ffd34d', '#ffffff'],
  ['star', 'star-rating', '評価', 'rating', ['評価', '高評価', 'レビュー'], ['rating', 'review', 'feedback'], '#ffb347', '#ffffff'],
  ['star', 'star-goal', '目玉', 'highlight', ['目玉', '注目', '見どころ'], ['highlight', 'feature', 'spotlight'], '#ff8fa3', '#ffffff'],
  ['heart', 'heart-love', 'ハート', 'heart', ['ハート', '愛情', '大好き'], ['heart', 'love'], '#ff6b8a', '#ffffff'],
  ['heart', 'heart-care', '思いやり', 'care', ['思いやり', '気遣い', 'ケア'], ['care', 'kindness', 'empathy'], '#ffa6b9', '#ffffff'],
  ['heart', 'heart-health', '健康', 'health', ['健康', '医療', '病院'], ['health', 'medical', 'hospital'], '#f26d6d', '#ffffff'],
  ['gear', 'gear-setting', '設定', 'settings', ['設定', '歯車'], ['settings', 'gear', 'configuration'], '#b7c0cc', '#5a6676'],
  ['gear', 'gear-process', '仕組み', 'mechanism', ['仕組み', '機構', 'プロセス'], ['mechanism', 'process', 'machinery'], '#a9d0e8', '#3d6f94'],
  ['gear', 'gear-engine', '開発', 'development', ['開発', 'エンジニア', '実装'], ['development', 'engineering', 'implementation'], '#c8b8e8', '#6a4fa3'],
  ['flag', 'flag-goal', 'ゴール', 'goal', ['ゴール', '目標', '到達'], ['goal', 'target', 'objective'], '#ff6b6b', '#15191f'],
  ['flag', 'flag-milestone', 'マイルストーン', 'milestone', ['マイルストーン', '節目'], ['milestone', 'checkpoint'], '#4dabf7', '#15191f'],
  ['flag', 'flag-start', '開始', 'start', ['開始', 'スタート', 'キックオフ'], ['kickoff', 'launch day', 'start line'], '#69db7c', '#15191f'],
  ['key', 'key-access', '鍵', 'key', ['鍵', 'キー'], ['key', 'keys'], '#ffd43b', '#e67700'],
  ['key', 'key-answer', '決め手', 'key point', ['決め手', 'カギ', '要点'], ['key point', 'key factor', 'crux'], '#ffe066', '#f08c00'],
  ['key', 'key-admin', '権限', 'permission', ['権限', 'アクセス権', '許可'], ['permission', 'access right', 'privilege'], '#ced4da', '#495057'],
  ['bell', 'bell-notice', '通知', 'notification', ['通知', 'お知らせ', 'アラート'], ['notification', 'alert', 'reminder'], '#ffd43b', '#e8590c'],
  ['bell', 'bell-alarm', '警報', 'alarm', ['警報', '警告', 'アラーム'], ['alarm', 'warning'], '#ff8787', '#c92a2a'],
  ['bell', 'bell-celebrate', 'お祝い', 'celebration', ['お祝い', '祝', '記念'], ['celebration', 'congratulations', 'anniversary'], '#ffe3a3', '#e8590c'],
  ['clock', 'clock-time', '時間', 'time', ['時間', '時計', '時刻'], ['time', 'clock', 'hours'], '#fff3bf', '#15191f'],
  ['clock', 'clock-deadline', '締め切り', 'deadline', ['締め切り', '締切', '期限', '納期'], ['deadline', 'due date', 'cutoff'], '#ffc9c9', '#c92a2a'],
  ['clock', 'clock-schedule', '予定', 'schedule', ['予定', 'スケジュール', '日程'], ['schedule', 'agenda', 'timetable'], '#d0ebff', '#1971c2'],
  ['phone', 'phone-mobile', 'スマホ', 'smartphone', ['スマホ', 'スマートフォン', '携帯'], ['smartphone', 'mobile', 'phone'], '#adb5bd', '#e7f5ff'],
  ['phone', 'phone-app', 'アプリ', 'app', ['アプリ', 'アプリケーション'], ['app', 'application'], '#74c0fc', '#ffffff'],
  ['phone', 'phone-call', '電話', 'call', ['電話', '通話', '連絡'], ['call', 'telephone', 'phone call'], '#b2f2bb', '#2b8a3e'],
  ['monitor', 'monitor-screen', '画面', 'screen', ['画面', 'モニター', 'ディスプレイ'], ['screen', 'monitor', 'display'], '#ced4da', '#e7f5ff'],
  ['monitor', 'monitor-system', 'システム', 'system', ['システム', 'パソコン', 'サーバー'], ['system', 'computer', 'server'], '#b197fc', '#f3f0ff'],
  ['monitor', 'monitor-web', 'ウェブ', 'website', ['ウェブ', 'サイト', 'ホームページ'], ['website', 'web page', 'homepage'], '#63e6be', '#e6fcf5'],
  ['bag', 'bag-shopping', '買い物', 'shopping', ['買い物', '購入', '買う'], ['shopping', 'purchase', 'buying'], '#ffa8a8', '#ffffff'],
  ['bag', 'bag-bag', 'かばん', 'bag', ['かばん', '鞄', 'カバン'], ['bag', 'backpack', 'briefcase'], '#a5d8ff', '#1864ab'],
  ['bag', 'bag-travel', '旅行', 'travel', ['旅行', '出張', '旅'], ['travel', 'trip', 'business trip'], '#ffd8a8', '#d9480f'],
  ['bottle', 'bottle-water', '水', 'water', ['水', 'ペットボトル'], ['water', 'bottle'], '#a5d8ff', '#e7f5ff'],
  ['bottle', 'bottle-medicine', '薬', 'medicine', ['薬', '処方'], ['medicine', 'drug', 'prescription'], '#ffe8cc', '#e8590c'],
  ['bottle', 'bottle-drink', '飲み物', 'drink', ['飲み物', 'ドリンク', 'ジュース'], ['drink', 'beverage', 'juice'], '#ffc9c9', '#fa5252'],
  ['car', 'car-vehicle', '車', 'car', ['自動車', '車で', '運転'], ['car', 'vehicle', 'driving'], '#ff8787', '#343a40'],
  ['car', 'car-taxi', 'タクシー', 'taxi', ['タクシー', '配車'], ['taxi', 'cab', 'ride'], '#ffe066', '#343a40'],
  ['car', 'car-transport', '輸送', 'transport', ['輸送', '運搬', 'トラック'], ['transport', 'truck', 'logistics'], '#74c0fc', '#343a40'],
  ['bulb', 'bulb-idea', 'アイデア電球', 'idea bulb', ['発想', '企画', '着想'], ['brainstorm', 'concept', 'inspiration'], '#fff3bf', '#868e96'],
  ['bulb', 'bulb-light', '照明', 'light', ['照明', '電気', '明かり'], ['lighting', 'lamp', 'electricity'], '#ffec99', '#868e96'],
  ['bulb', 'bulb-energy', '省エネ', 'energy saving', ['省エネ', '節電', 'エネルギー'], ['energy saving', 'energy', 'power saving'], '#b2f2bb', '#868e96'],
  ['envelope', 'mail-letter', 'メール', 'mail', ['メール', '郵便', '手紙'], ['mail', 'email', 'letter'], '#fff9db', '#e67700'],
  ['envelope', 'mail-invite', '招待', 'invitation', ['招待', '案内状', '招待状'], ['invitation', 'invite'], '#ffdeeb', '#c2255c'],
  ['envelope', 'mail-message', 'メッセージ', 'message', ['メッセージ', '伝言', '返信'], ['message', 'reply', 'inbox'], '#d0ebff', '#1864ab'],
  ['document', 'doc-report', '報告書', 'report', ['報告書', 'レポート', '報告'], ['report', 'writeup'], '#ffffff', '#4c6ef5'],
  ['document', 'doc-contract', '契約', 'contract', ['契約', '契約書', '合意書'], ['contract', 'agreement'], '#fff5f5', '#e03131'],
  ['document', 'doc-minutes', '議事録', 'minutes', ['議事録', 'メモ', '記録'], ['minutes', 'memo', 'notes'], '#f8f9fa', '#495057'],
  ['document', 'doc-plan', '計画書', 'plan document', ['計画書', '企画書', '提案書'], ['proposal', 'plan document', 'spec'], '#e3fafc', '#0b7285'],
  ['folder', 'folder-files', 'フォルダ', 'folder', ['フォルダ', 'ファイル', '資料'], ['folder', 'files', 'documents'], '#ffe066', '#e67700'],
  ['folder', 'folder-archive', '保管', 'archive', ['保管', 'アーカイブ', '保存'], ['archive', 'storage', 'backup'], '#ced4da', '#495057'],
  ['folder', 'folder-project', 'プロジェクト', 'project', ['プロジェクト', '案件'], ['project', 'case', 'engagement'], '#a5d8ff', '#1971c2'],
  ['chart', 'chart-bar', 'グラフ', 'chart', ['グラフ', '統計', '指標'], ['chart', 'graph', 'metrics'], '#74c0fc', '#e03131'],
  ['chart', 'chart-sales', '売上', 'sales', ['売上', '売り上げ', '収益'], ['sales', 'revenue', 'profit'], '#8ce99a', '#e03131'],
  ['chart', 'chart-trend', '傾向', 'trend', ['傾向', '推移', 'トレンド'], ['trend', 'forecast', 'analysis'], '#ffd8a8', '#1971c2'],
  ['magnifier', 'search-find', '検索', 'search', ['検索', '探す', '調べ'], ['search', 'find', 'look for'], '#d0ebff', '#1864ab'],
  ['magnifier', 'search-research', '調査', 'research', ['調査', '研究', '分析'], ['research', 'investigate', 'survey'], '#e5dbff', '#5f3dc4'],
  ['magnifier', 'search-check', '確認', 'check', ['確認', '点検', '検査'], ['inspection', 'verify', 'check'], '#d3f9d8', '#2b8a3e'],
  ['lock', 'lock-secure', '安全', 'security', ['セキュリティ', '安全', '暗号'], ['security', 'secure', 'encryption'], '#ffd43b', '#343a40'],
  ['lock', 'lock-private', '機密', 'confidential', ['機密', '秘密', '非公開'], ['confidential', 'secret', 'private'], '#ff8787', '#ffffff'],
  ['lock', 'lock-password', 'パスワード', 'password', ['パスワード', '認証', 'ログイン'], ['password', 'authentication', 'login'], '#a5d8ff', '#1864ab'],
  ['pencil', 'pencil-write', '書く', 'write', ['書く', '記入', '執筆'], ['write', 'writing', 'draft'], '#ffd43b', '#fa5252'],
  ['pencil', 'pencil-edit', '修正', 'edit', ['修正', '編集', '直し'], ['edit', 'revise', 'fix'], '#a5d8ff', '#fa5252'],
  ['pencil', 'pencil-design', 'デザイン', 'design', ['デザイン', '設計', '図面'], ['design', 'sketch', 'drawing'], '#d0bfff', '#fa5252'],
  ['rocket', 'rocket-launch', 'ローンチ', 'launch', ['ローンチ', 'リリース', '公開'], ['launch', 'release', 'go live'], '#f8f9fa', '#fa5252'],
  ['rocket', 'rocket-startup', 'スタートアップ', 'startup', ['スタートアップ', '起業', '新規事業'], ['startup', 'venture', 'new business'], '#e5dbff', '#f76707'],
  ['rocket', 'rocket-speed', '加速', 'acceleration', ['加速', '急成長', '飛躍'], ['accelerate', 'speed up', 'boost'], '#c5f6fa', '#e64980'],
  ['boat', 'boat-sail', '船', 'ship', ['船', '航海', '港'], ['ship', 'sailing', 'harbor'], '#ffffff', '#1c7ed6'],
  ['boat', 'boat-journey', '旅路', 'voyage', ['旅路', '船出', '出航'], ['voyage', 'set sail', 'journey'], '#fff3bf', '#e8590c'],
  ['plane', 'plane-fly', '飛行機', 'airplane', ['飛行機', '空港', '飛ぶ'], ['airplane', 'flight', 'airport'], '#e7f5ff', '#1971c2'],
  ['plane', 'plane-send', '送信', 'send', ['送信', '発送', '送る'], ['send', 'submit', 'dispatch'], '#d3f9d8', '#2b8a3e'],
  ['plane', 'plane-global', '海外', 'overseas', ['海外', '国際', 'グローバル'], ['overseas', 'international', 'global'], '#fff0f6', '#c2255c'],
  ['mountain', 'mountain-peak', '山', 'mountain', ['登山', '山頂', '山'], ['mountain', 'summit', 'peak'], '#8ce99a', '#ffffff'],
  ['mountain', 'mountain-hurdle', '壁', 'hurdle', ['障壁', '難関', 'ハードル'], ['hurdle', 'obstacle', 'barrier'], '#ced4da', '#ffffff'],
  ['mountain', 'mountain-challenge', '挑戦', 'challenge', ['挑戦', 'チャレンジ'], ['challenge', 'take on'], '#ffc9c9', '#ffffff'],
  ['sun', 'sun-day', '太陽', 'sun', ['太陽', '晴れ', '日差し'], ['sun', 'sunny', 'sunshine'], '#ffd43b', '#f76707'],
  ['sun', 'sun-morning', '朝', 'morning', ['朝', '早朝', '始業'], ['morning', 'sunrise', 'dawn'], '#ffe8cc', '#f76707'],
  ['sun', 'sun-hope', '希望', 'hope', ['希望', '期待', '未来'], ['hope', 'future', 'bright'], '#fff3bf', '#f08c00'],
  ['moon', 'moon-night', '夜', 'night', ['夜', '深夜', '月'], ['night', 'moon', 'midnight'], '#fff3bf', '#adb5bd'],
  ['moon', 'moon-sleep', '睡眠', 'sleep', ['睡眠', '寝る', '就寝'], ['sleep', 'bedtime', 'nap'], '#dbe4ff', '#748ffc'],
  ['moon', 'moon-overtime', '残業', 'overtime', ['残業', '夜勤', '徹夜'], ['overtime', 'night shift', 'late work'], '#e5dbff', '#7048e8'],
  ['coin', 'coin-money', 'お金', 'money', ['お金', '現金', '資金'], ['money', 'cash', 'funds'], '#ffd43b', '#e67700'],
  ['coin', 'coin-cost', 'コスト', 'cost', ['コスト', '費用', '予算'], ['cost', 'expense', 'budget'], '#ffe066', '#d9480f'],
  ['coin', 'coin-price', '価格', 'price', ['価格', '値段', '料金'], ['price', 'pricing', 'fee'], '#fff3bf', '#e67700'],
  ['gift', 'gift-present', 'プレゼント', 'gift', ['プレゼント', '贈り物', '特典'], ['gift', 'present', 'bonus'], '#ffa8a8', '#4dabf7'],
  ['gift', 'gift-reward', '報酬', 'reward', ['報酬', '褒美', 'ご褒美'], ['reward', 'incentive', 'prize'], '#d0bfff', '#ffd43b'],
  ['gift', 'gift-campaign', 'キャンペーン', 'campaign', ['キャンペーン', '景品', '懸賞'], ['campaign', 'giveaway', 'promotion'], '#8ce99a', '#ff6b6b'],
  ['chair', 'chair-seat', '椅子', 'chair', ['椅子', 'イス', '座席'], ['chair', 'seat'], '#ffc078', '#7a4a2a'],
  ['chair', 'chair-meeting', '会議', 'meeting', ['会議', 'ミーティング', '打ち合わせ'], ['meeting', 'conference', 'session'], '#a5d8ff', '#1864ab'],
  ['table', 'table-desk', '机', 'desk', ['机', 'デスク', '作業台'], ['desk', 'workbench'], '#ffd8a8', '#7a4a2a'],
  ['table', 'table-dining', '食卓', 'dining table', ['食卓', 'テーブル', '食事'], ['dining table', 'table', 'meal'], '#ffe8cc', '#8a5a33'],
  ['camera', 'camera-photo', '写真', 'photo', ['写真', 'カメラ', '撮影'], ['photo', 'camera', 'photograph'], '#ced4da', '#1864ab'],
  ['camera', 'camera-video', '動画', 'video', ['動画', 'ビデオ', '録画'], ['video', 'footage', 'recording'], '#ffc9c9', '#364fc7'],
  ['camera', 'camera-live', '配信', 'broadcast', ['配信', 'ライブ', '中継'], ['broadcast', 'livestream', 'streaming'], '#d0bfff', '#e03131'],
  ['headphone', 'headphone-music', '音楽', 'music', ['音楽', 'ヘッドホン', '曲'], ['music', 'headphones', 'song'], '#ffa8a8', '#ffffff'],
  ['headphone', 'headphone-listen', '傾聴', 'listening', ['傾聴', '聞く', '聴く'], ['listening', 'listen', 'hear'], '#a5d8ff', '#ffffff'],
  ['headphone', 'headphone-support', 'サポート', 'support', ['サポート', '問い合わせ', 'コールセンター'], ['support', 'helpdesk', 'customer service'], '#b2f2bb', '#ffffff'],
  ['trophy', 'trophy-win', '優勝', 'victory', ['優勝', '勝利', '勝つ'], ['victory', 'winner', 'champion'], '#ffd43b', '#e67700'],
  ['trophy', 'trophy-award', '表彰', 'award', ['表彰', '受賞', '賞'], ['award', 'honor', 'recognition'], '#ffe066', '#c92a2a'],
  ['trophy', 'trophy-success', '成功', 'success', ['成功', '達成', '成果'], ['success', 'achievement', 'accomplish'], '#fff3bf', '#2b8a3e'],
  ['umbrella', 'umbrella-rain', '傘', 'umbrella', ['傘', '雨具'], ['umbrella'], '#74c0fc', '#1864ab'],
  ['umbrella', 'umbrella-insurance', '保険', 'insurance', ['保険', '補償', '保証'], ['insurance', 'coverage', 'warranty'], '#ff8787', '#c92a2a'],
  ['umbrella', 'umbrella-risk', 'リスク対策', 'risk measure', ['リスク対策', '備え', '予防'], ['risk mitigation', 'safeguard', 'prevention'], '#b197fc', '#5f3dc4'],
  ['puzzle', 'puzzle-fit', 'パズル', 'puzzle', ['パズル', '組み合わせ', '噛み合'], ['puzzle', 'fit together', 'piece'], '#74c0fc', '#ffffff'],
  ['puzzle', 'puzzle-solution', '解決策', 'solution', ['解決策', '解決', '対策'], ['solution', 'solve', 'workaround'], '#8ce99a', '#ffffff'],
  ['puzzle', 'puzzle-integrate', '連携', 'integration', ['連携', '統合', '接続'], ['integration', 'connect', 'interface'], '#ffa8a8', '#ffffff'],
  ['people', 'people-team', 'チーム', 'team', ['チーム', 'メンバー', '仲間'], ['team', 'members', 'colleagues'], '#74c0fc', '#ffd43b'],
  ['people', 'people-customer', '顧客', 'customer', ['顧客', 'お客様', 'ユーザー'], ['customer', 'client', 'user'], '#ffa8a8', '#ffd43b'],
  ['people', 'people-community', '地域', 'community', ['地域', 'コミュニティ', '住民'], ['community', 'neighborhood', 'residents'], '#8ce99a', '#ffd43b'],
  ['wrench', 'wrench-repair', '修理', 'repair', ['修理', '故障', '保守'], ['repair', 'maintenance', 'breakdown'], '#ced4da', '#e03131'],
  ['wrench', 'wrench-tool', '道具', 'tool', ['道具', 'ツール', '工具'], ['tool', 'toolbox', 'utility'], '#ffd8a8', '#e8590c'],
  ['wrench', 'wrench-improve', '改善', 'improvement', ['改善', 'カイゼン', '調整'], ['improvement', 'tune', 'optimize'], '#a5d8ff', '#1864ab'],
  ['battery', 'battery-power', 'バッテリー', 'battery', ['バッテリー', '充電', '電池'], ['battery', 'charge', 'charging'], '#b2f2bb', '#2b8a3e'],
  ['battery', 'battery-low', '電池切れ', 'low battery', ['電池切れ', '消耗', '疲弊'], ['low battery', 'drained', 'burnout'], '#ffc9c9', '#c92a2a'],
  ['battery', 'battery-capacity', '余力', 'capacity', ['余力', 'キャパシティ', '余裕'], ['capacity', 'bandwidth', 'headroom'], '#ffec99', '#e67700'],
  ['ticket', 'ticket-event', 'チケット', 'ticket', ['チケット', 'イベント', '入場'], ['ticket', 'event', 'admission'], '#ffd8a8', '#e8590c'],
  ['ticket', 'ticket-coupon', 'クーポン', 'coupon', ['クーポン', '割引', '優待'], ['coupon', 'discount', 'voucher'], '#d8f5a2', '#5c940d'],
  ['ticket', 'ticket-issue', '課題票', 'issue ticket', ['チケット管理', '起票', '課題票'], ['issue ticket', 'ticketing', 'backlog'], '#eebefa', '#9c36b5'],
];

function wrapPart(def) {
  const [sil, key, ja, en, , , a, b] = def;
  return `<g data-part-key="${key}" fill="none" stroke="${INK}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">`
    + `<title>${en}</title>${SIL[sil](a, b)}${HI}</g>`;
}

const PARTS = new Map();
for (const d of DEFS) {
  const [sil, key, ja, en, jaWords, enWords] = d;
  if (!SIL[sil] || PARTS.has(key)) throw new Error(`同梱部品の定義が不正: ${key}`);
  PARTS.set(key, { key, label: { ja, en }, jaWords, enWords, svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48">${wrapPart(d)}</svg>`, inner: wrapPart(d) });
}

// ---- 部品キーで引く ----
export const isPartKey = (key) => typeof key === 'string' && PARTS.has(key);
export const getPartKeys = () => [...PARTS.keys()];
export function getPartInfo(key, lang = 'ja') {
  const p = PARTS.get(key);
  if (!p) return null;
  return { key: p.key, label: p.label[lang === 'en' ? 'en' : 'ja'] };
}
export const getPartWords = (key) => { const p = PARTS.get(key); return p ? { ja: [...p.jaWords], en: [...p.enWords] } : null; };
// 部品の SVG（単体の <svg> 文字列）。なければ null。
export const getPartSvg = (key) => PARTS.get(key)?.svg ?? null;
// 図に埋め込む <g>（48x48 の座標。呼び出し側が transform で置く）
export const getPartGroup = (key) => PARTS.get(key)?.inner ?? null;

// ---- SVG の許可リスト検査（NFR-SEC-004 と同じ規則。要素・属性は列挙したものだけ、外部への参照・スクリプトなし）----
export const OK_TAGS = new Set(['svg', 'g', 'title', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon', 'text', 'tspan']);
export const OK_ATTRS = new Set(['xmlns', 'viewBox', 'width', 'height', 'x', 'y', 'cx', 'cy', 'r', 'rx', 'ry', 'x1', 'y1', 'x2', 'y2', 'd', 'points', 'transform', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-opacity', 'fill-opacity', 'stroke-dasharray', 'opacity', 'data-part-key', 'data-expression', 'data-character', 'role', 'aria-label', 'aria-hidden', 'font-size', 'font-weight', 'text-anchor', 'font-family']);
export function isAllowedPartSvg(svg) {
  const s = String(svg ?? '');
  if (!/^\s*<svg[\s>]/.test(s) || /<!|<\?/.test(s)) return false;
  if (/javascript:|data:|https?:|\/\/|url\(|[@]import|&#|<script|<foreignObject|<use|<image/i.test(s.replace(' xmlns="http://www.w3.org/2000/svg"', ''))) return false;
  const tagRe = /<\/?([A-Za-z][\w-]*)((?:\s+[\w:-]+="[^"]*")*)\s*\/?>/g;
  let m;
  while ((m = tagRe.exec(s))) {
    if (!OK_TAGS.has(m[1])) return false;
    const attrRe = /\s([\w:-]+)="([^"]*)"/g; let a;
    while ((a = attrRe.exec(m[2]))) if (!OK_ATTRS.has(a[1])) return false;
  }
  // タグとして解釈できない '<' '>' が残っていないこと（文字は許す）
  return !/[<>]/.test(s.replace(tagRe, ''));
}
// ---- 語（辞書）→ 部品。日本語は部分一致、英語は語頭一致（語境界）。出現順・重複なし ----
const ENTRIES = [];
for (const p of PARTS.values()) {
  for (const w of p.jaWords) ENTRIES.push({ key: p.key, word: w, ja: true });
  for (const w of p.enWords) ENTRIES.push({ key: p.key, word: w, ja: false });
}
const esc = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
for (const e of ENTRIES) e.re = e.ja ? null : new RegExp(`\\b${esc(e.word)}`, 'i');
export function matchParts(text, limit = 4) {
  const s = String(text ?? ''); const lower = s.toLowerCase();
  const best = new Map();
  for (const e of ENTRIES) {
    let at = -1;
    if (e.ja) at = s.indexOf(e.word); else { const m = e.re.exec(lower); at = m ? m.index : -1; }
    if (at < 0) continue;
    const cur = best.get(e.key);
    if (!cur || at < cur.at || (at === cur.at && e.word.length > cur.word.length)) best.set(e.key, { at, key: e.key, word: s.substr(at, e.word.length) });
  }
  return [...best.values()].sort((a, b) => a.at - b.at || a.key.localeCompare(b.key)).slice(0, limit).map(({ key, word }) => ({ key, word }));
}

// ---- 汎用キャラのビルダー（実在人物を特定しない。属性は下の汎用の候補だけ。顔写真・名前・話者との対応づけの入力は持たない）----
export const CHARACTER_OPTIONS = Object.freeze({
  hair: Object.freeze(['short', 'long', 'bob', 'ponytail', 'spiky', 'bun']),
  hairColor: Object.freeze(['black', 'brown', 'blonde', 'red', 'blue', 'gray']),
  outfit: Object.freeze(['shirt', 'suit', 'dress', 'hoodie', 'uniform', 'apron']),
  expression: Object.freeze(['neutral', ...EMOTIONS.map((e) => e.id)]),
});
const HAIR_COLORS = { black: '#2b2b33', brown: '#7a4a2a', blonde: '#f2c94c', red: '#d9480f', blue: '#4263eb', gray: '#adb5bd' };
const OUTFIT_COLORS = { shirt: '#74c0fc', suit: '#495057', dress: '#f783ac', hoodie: '#8ce99a', uniform: '#364fc7', apron: '#ffd8a8' };
export const EXPRESSION_LABELS = {
  neutral: { ja: 'ふつう', en: 'neutral' }, confused: { ja: '混乱', en: 'confused' }, trouble: { ja: '困った', en: 'in trouble' },
  anxious: { ja: '不安', en: 'anxious' }, angry: { ja: '怒り', en: 'angry' }, happy: { ja: 'うれしい', en: 'happy' },
  idea: { ja: 'ひらめき', en: 'idea' }, surprised: { ja: '驚き', en: 'surprised' }, tired: { ja: '疲れ', en: 'tired' },
};
const FACE = {
  neutral: '<path d="M18 30h4M30 30h4" /><path d="M21 38h10"/>',
  confused: '<path d="M17 28l6 2M35 28l-6 2"/><circle cx="20" cy="32" r="1.500"/><circle cx="32" cy="32" r="1.500"/><path d="M21 39q3-2 4 0t4 0"/>',
  trouble: '<path d="M17 29l5-2M35 29l-5-2"/><circle cx="20" cy="32" r="1.500"/><circle cx="32" cy="32" r="1.500"/><path d="M21 40q5-3 10 0"/><path d="M38 24q2 3 0 4q-2-1 0-4z"/>',
  anxious: '<path d="M17 28q3-3 6 0M29 28q3-3 6 0"/><circle cx="20" cy="32" r="1.500"/><circle cx="32" cy="32" r="1.500"/><path d="M22 40q4-2 8 0"/>',
  angry: '<path d="M16 27l7 3M36 27l-7 3"/><circle cx="20" cy="33" r="1.500"/><circle cx="32" cy="33" r="1.500"/><path d="M22 41q4-3 8 0"/>',
  happy: '<path d="M17 32q3-4 6 0M29 32q3-4 6 0"/><path d="M20 37q6 6 12 0z" fill="#ffffff"/>',
  idea: '<circle cx="20" cy="31" r="2"/><circle cx="32" cy="31" r="2"/><path d="M22 38q4 4 8 0"/><path d="M26 6v4M20 8l2 3M32 8l-2 3"/>',
  surprised: '<circle cx="20" cy="31" r="2.500"/><circle cx="32" cy="31" r="2.500"/><ellipse cx="26" cy="40" rx="3" ry="4" fill="#ffffff"/>',
  tired: '<path d="M17 31h6M29 31h6"/><path d="M22 40h8"/><path d="M36 22q2 3 0 4q-2-1 0-4z"/>',
};
const HAIR = {
  short: (c) => `<path d="M12 28a14 16 0 0 1 28 0c-4-4-8-8-14-8s-10 4-14 8z" fill="${c}"/>`,
  long: (c) => `<path d="M10 44V26a16 18 0 0 1 32 0v18h-6V28c-5-3-9-7-10-9-1 2-5 6-10 9v16z" fill="${c}"/>`,
  bob: (c) => `<path d="M10 38V26a16 16 0 0 1 32 0v12h-6V26c-5-1-8-4-10-6-2 2-5 5-10 6v12z" fill="${c}"/>`,
  ponytail: (c) => `<path d="M12 28a14 16 0 0 1 28 0c-4-4-8-8-14-8s-10 4-14 8z" fill="${c}"/><path d="M40 22q8 4 4 14q-3-6-6-8z" fill="${c}"/>`,
  spiky: (c) => `<path d="M11 29l-2-12 8 6 3-10 5 8 5-8 3 10 8-6-2 12c-4-4-8-7-14-7s-10 3-14 7z" fill="${c}"/>`,
  bun: (c) => `<circle cx="26" cy="10" r="5" fill="${c}"/><path d="M12 28a14 16 0 0 1 28 0c-4-4-8-8-14-8s-10 4-14 8z" fill="${c}"/>`,
};
const BODY = {
  shirt: (c) => `<path d="M8 52a18 12 0 0 1 36 0z" fill="${c}"/><path d="M26 44v8" fill="none"/>`,
  suit: (c) => `<path d="M8 52a18 12 0 0 1 36 0z" fill="${c}"/><path d="M26 44l-5 8M26 44l5 8" fill="#ffffff"/><path d="M26 46l-2 6h4z" fill="#e03131"/>`,
  dress: (c) => `<path d="M10 52a16 12 0 0 1 32 0z" fill="${c}"/><path d="M20 44q6 4 12 0" fill="none" stroke="#ffffff"/>`,
  hoodie: (c) => `<path d="M8 52a18 12 0 0 1 36 0z" fill="${c}"/><path d="M18 44q8 6 16 0" fill="none"/><path d="M24 48v4M28 48v4" stroke="#ffffff"/>`,
  uniform: (c) => `<path d="M8 52a18 12 0 0 1 36 0z" fill="${c}"/><path d="M22 44l4 5 4-5" fill="#ffffff"/><circle cx="26" cy="51" r="1" fill="#ffd43b"/>`,
  apron: (c) => `<path d="M8 52a18 12 0 0 1 36 0z" fill="#f1f3f5"/><path d="M18 46h16v6H18z" fill="${c}"/>`,
};
const pick = (list, v) => (list.includes(v) ? v : list[0]);
// 属性（髪型・髪色・服装・表情）から SVG の <svg> を返す。同じ属性なら同じ文字列（決定的）。候補にない値は先頭の候補にする。
export function buildCharacter(attrs = {}, opts = {}) {
  const lang = opts.lang === 'en' ? 'en' : 'ja';
  const hair = pick(CHARACTER_OPTIONS.hair, attrs?.hair);
  const hairColor = pick(CHARACTER_OPTIONS.hairColor, attrs?.hairColor);
  const outfit = pick(CHARACTER_OPTIONS.outfit, attrs?.outfit);
  const expression = pick(CHARACTER_OPTIONS.expression, attrs?.expression);
  const label = EXPRESSION_LABELS[expression][lang];
  const hc = HAIR_COLORS[hairColor];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 52 76" width="52" height="76" role="img" aria-label="${label}">`
    + `<g data-character="generic" data-expression="${expression}" fill="none" stroke="${INK}" stroke-width="2.500" stroke-linecap="round" stroke-linejoin="round">`
    + `<title>${label}</title>${BODY[outfit](OUTFIT_COLORS[outfit])}`
    + `<ellipse cx="26" cy="30" rx="14" ry="15" fill="#ffe3cf"/>${FACE[expression]}${HAIR[hair](hc)}`
    + `<path d="M13 28q2-2 4 0" stroke="none"/></g>`
    + `<text x="26" y="73" font-size="9" text-anchor="middle" fill="${INK}" stroke="none" font-weight="700">${label}</text></svg>`;
}
// 発話の感情語（emotion.js の 8 種）から、汎用キャラの表情を決める。感情語がなければ neutral。
export function expressionForText(text) {
  const h = detectEmotions(text)[0];
  return h ? h.id : 'neutral';
}
