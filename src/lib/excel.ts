import * as XLSX from 'xlsx';
import {
  DifficultyLevel,
  ExcelImportRow,
  ExerciseType,
  LessonItem,
  SkillType,
} from '../shared/types';

function normalizeKey(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

function parseSkill(raw: string): SkillType {
  const val = normalizeKey(raw || '');
  if (val.includes('listen') || val.includes('nghe')) return 'listen';
  if (val.includes('read') || val.includes('doc')) return 'read';
  if (val.includes('write') || val.includes('viet') || val.includes('go')) return 'write';
  return 'recognize';
}

function parseExerciseType(raw: string, skill: SkillType, optionsCount: number): ExerciseType {
  const val = normalizeKey(raw || '');
  if (val.includes('handwriting') || val.includes('tap_viet') || val.includes('ve_chu')) return 'handwriting';
  if (val.includes('speak') || val.includes('doc_to') || val.includes('noi')) return 'speak_read';
  if (val.includes('word_bank') || val.includes('ghep_tu') || val.includes('sap_xep')) return 'word_bank';
  if (val.includes('type') || val.includes('go_chu') || val.includes('chinh_ta')) return 'type_coho';
  if (val.includes('listen') || val.includes('nghe_chon')) return 'listen_select';
  if (val.includes('multiple') || val.includes('trac_nghiem')) return 'multiple_choice';

  if (skill === 'listen') return optionsCount > 1 ? 'listen_select' : 'type_coho';
  if (skill === 'write') return 'type_coho';
  if (skill === 'read') return optionsCount > 1 ? 'multiple_choice' : 'speak_read';
  return 'multiple_choice';
}

function getField(record: Record<string, string>, aliases: string[]): string {
  for (const alias of aliases) {
    if (record[alias] !== undefined && record[alias] !== '') {
      return String(record[alias]).trim();
    }
  }
  return '';
}

export interface ParsedExcelResult {
  rows: ExcelImportRow[];
  warnings: string[];
}

export async function parseExcelFile(file: File): Promise<ParsedExcelResult> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    return { rows: [], warnings: ['Tệp Excel không có trang tính (sheet) nào.'] };
  }

  const sheet = workbook.Sheets[firstSheetName];
  const rawJson = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
  const rows: ExcelImportRow[] = [];
  const warnings: string[] = [];

  rawJson.forEach((rawRow, idx) => {
    const normalized: Record<string, string> = {};
    for (const [k, v] of Object.entries(rawRow)) {
      normalized[normalizeKey(k)] = String(v ?? '').trim();
    }

    const levelRaw = getField(normalized, ['cap_do', 'level', 'cap', 'do_kho']);
    const parsedLevel = Number(levelRaw.replace(/[^0-9]/g, '')) || 1;
    const level = Math.min(5, Math.max(1, parsedLevel)) as DifficultyLevel;

    const lessonTitle =
      getField(normalized, ['ten_bai_hoc', 'bai_hoc', 'lesson_title', 'lesson', 'chu_de']) ||
      `Bài học cấp độ ${level}`;
    const lessonDescription = getField(normalized, ['mo_ta_bai', 'lesson_description', 'description']);
    const skillRaw = getField(normalized, ['ky_nang', 'skill']);
    const skill = parseSkill(skillRaw);

    const optionsRaw = getField(normalized, ['cac_lua_chon', 'lua_chon', 'options', 'dap_an_nhieu']);
    const options = optionsRaw
      ? optionsRaw
          .split(/[|;]/)
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

    const typeRaw = getField(normalized, ['loai_bai_tap', 'exercise_type', 'type', 'dang_bai']);
    const exerciseType = parseExerciseType(typeRaw, skill, options.length);

    const cohoText = getField(normalized, ['chu_co_ho', 'tieng_co_ho', 'coho_text', 'coho', 'tu_vung']);
    const vietnameseText = getField(normalized, ['nghia_tieng_viet', 'tieng_viet', 'vietnamese_text', 'meaning', 'nghia']);
    const prompt =
      getField(normalized, ['cau_hoi', 'prompt', 'question', 'yeu_cau']) ||
      (cohoText ? `Nhận biết và thực hành: "${cohoText}"` : '');
    const correctAnswer =
      getField(normalized, ['dap_an_dung', 'dap_an', 'correct_answer', 'answer']) ||
      cohoText ||
      vietnameseText;

    if (!cohoText && !vietnameseText && !prompt) {
      warnings.push(`Dòng ${idx + 2}: Bỏ qua vì thiếu nội dung câu hỏi và từ Cơ Ho.`);
      return;
    }

    if (
      (exerciseType === 'multiple_choice' || exerciseType === 'listen_select' || exerciseType === 'word_bank') &&
      options.length === 0
    ) {
      options.push(correctAnswer);
    }

    rows.push({
      level,
      lessonTitle,
      lessonDescription,
      skill,
      exerciseType,
      prompt: prompt || `Thực hành chữ Cơ Ho: ${cohoText}`,
      cohoText: cohoText || correctAnswer,
      vietnameseText: vietnameseText || correctAnswer,
      phonetic: getField(normalized, ['phien_am_goi_y', 'phien_am', 'phonetic', 'cach_doc']),
      options,
      correctAnswer,
      audioUrl: getField(normalized, ['link_am_thanh', 'am_thanh', 'audio_url', 'audio']),
      hint: getField(normalized, ['goi_y', 'hint', 'ghi_chu']),
    });
  });

  return { rows, warnings };
}

export function exportCurriculumToExcel(lessons: LessonItem[], filename = 'du_lieu_hoc_chu_co_ho.xlsx'): void {
  const flatRows: Record<string, string | number>[] = [];

  for (const lesson of lessons) {
    for (const ex of lesson.exercises) {
      flatRows.push({
        'Cấp độ': lesson.level,
        'Tên bài học': lesson.title,
        'Mô tả bài': lesson.description,
        'Kỹ năng':
          ex.skill === 'recognize'
            ? 'Nhận biết'
            : ex.skill === 'listen'
              ? 'Nghe'
              : ex.skill === 'read'
                ? 'Đọc'
                : 'Viết',
        'Loại bài tập': ex.exerciseType,
        'Câu hỏi': ex.prompt,
        'Chữ Cơ Ho': ex.cohoText,
        'Nghĩa tiếng Việt': ex.vietnameseText,
        'Phiên âm gợi ý': ex.phonetic,
        'Các lựa chọn': ex.options.join(' | '),
        'Đáp án đúng': ex.correctAnswer,
        'Link âm thanh': ex.audioUrl,
        'Gợi ý': ex.hint,
      });
    }
  }

  const worksheet = XLSX.utils.json_to_sheet(flatRows);
  worksheet['!cols'] = [
    { wch: 10 },
    { wch: 28 },
    { wch: 32 },
    { wch: 14 },
    { wch: 18 },
    { wch: 38 },
    { wch: 20 },
    { wch: 24 },
    { wch: 20 },
    { wch: 34 },
    { wch: 20 },
    { wch: 24 },
    { wch: 34 },
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'DuLieuCoHo');
  XLSX.writeFile(workbook, filename);
}

export function downloadSampleExcelTemplate(): void {
  const sampleRows = [
    {
      'Cấp độ': 1,
      'Tên bài học': 'Nguyên âm Cơ Ho mẫu',
      'Mô tả bài': 'Làm quen nguyên âm ơ và chữ ñ',
      'Kỹ năng': 'Nhận biết',
      'Loại bài tập': 'multiple_choice',
      'Câu hỏi': 'Chữ nào đọc giống âm "nh" trong tiếng Việt?',
      'Chữ Cơ Ho': 'ñ',
      'Nghĩa tiếng Việt': 'Âm nh',
      'Phiên âm gợi ý': 'nhờ',
      'Các lựa chọn': 'ñ | ơ | ă | b̀',
      'Đáp án đúng': 'ñ',
      'Link âm thanh': '',
      'Gợi ý': 'Ký tự ñ xuất hiện trong từ Añ (Tôi).',
    },
    {
      'Cấp độ': 2,
      'Tên bài học': 'Gia đình thân yêu',
      'Mô tả bài': 'Từ vựng gia đình',
      'Kỹ năng': 'Nghe',
      'Loại bài tập': 'listen_select',
      'Câu hỏi': 'Nghe và chọn từ có nghĩa là "Mẹ"',
      'Chữ Cơ Ho': 'Mè',
      'Nghĩa tiếng Việt': 'Mẹ',
      'Phiên âm gợi ý': 'mè',
      'Các lựa chọn': 'Mè | Bàp | Kòn | Ôh',
      'Đáp án đúng': 'Mè',
      'Link âm thanh': '',
      'Gợi ý': 'Âm gần giống từ Mẹ tiếng Việt.',
    },
    {
      'Cấp độ': 3,
      'Tên bài học': 'Sinh hoạt hàng ngày',
      'Mô tả bài': 'Ghép cụm từ giao tiếp',
      'Kỹ năng': 'Đọc',
      'Loại bài tập': 'word_bank',
      'Câu hỏi': 'Ghép các thẻ từ thành cụm "Ăn cơm"',
      'Chữ Cơ Ho': 'Sa ồm',
      'Nghĩa tiếng Việt': 'Ăn cơm',
      'Phiên âm gợi ý': 'sa ồm',
      'Các lựa chọn': 'Sa | ồm | dak | bri',
      'Đáp án đúng': 'Sa ồm',
      'Link âm thanh': '',
      'Gợi ý': 'Sa là ăn, ồm là cơm.',
    },
    {
      'Cấp độ': 4,
      'Tên bài học': 'Câu giao tiếp ngắn',
      'Mô tả bài': 'Đọc to và phát âm chuẩn',
      'Kỹ năng': 'Đọc',
      'Loại bài tập': 'speak_read',
      'Câu hỏi': 'Đọc to câu: Tôi sống ở vùng núi',
      'Chữ Cơ Ho': 'Añ ơm bơnơm',
      'Nghĩa tiếng Việt': 'Tôi sống ở vùng núi',
      'Phiên âm gợi ý': 'anh ơm bơ-nơm',
      'Các lựa chọn': '',
      'Đáp án đúng': 'Añ ơm bơnơm',
      'Link âm thanh': '',
      'Gợi ý': 'Đọc rõ từng chữ: Añ - ơm - bơnơm.',
    },
    {
      'Cấp độ': 5,
      'Tên bài học': 'Viết chữ Cơ Ho nâng cao',
      'Mô tả bài': 'Gõ chính xác câu tiếng Cơ Ho',
      'Kỹ năng': 'Viết',
      'Loại bài tập': 'type_coho',
      'Câu hỏi': 'Viết câu: "Tôi học chữ Cơ Ho"',
      'Chữ Cơ Ho': 'Añ pơtò sră Cơ Ho',
      'Nghĩa tiếng Việt': 'Tôi học chữ Cơ Ho',
      'Phiên âm gợi ý': 'anh pơ-tò sơ-ră cơ ho',
      'Các lựa chọn': '',
      'Đáp án đúng': 'Añ pơtò sră Cơ Ho',
      'Link âm thanh': '',
      'Gợi ý': 'Dùng bàn phím ký tự đặc biệt Cơ Ho bên dưới ô nhập.',
    },
  ];

  const worksheet = XLSX.utils.json_to_sheet(sampleRows);
  worksheet['!cols'] = [
    { wch: 10 },
    { wch: 26 },
    { wch: 28 },
    { wch: 12 },
    { wch: 18 },
    { wch: 36 },
    { wch: 20 },
    { wch: 24 },
    { wch: 20 },
    { wch: 28 },
    { wch: 20 },
    { wch: 20 },
    { wch: 32 },
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'MauNhapDuLieuCoHo');
  XLSX.writeFile(workbook, 'mau_nhap_du_lieu_chu_co_ho.xlsx');
}
