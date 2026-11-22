import React, { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  RotateCcw,
  Upload,
} from 'lucide-react';
import { ExcelImportRow, LessonItem } from '../shared/types';
import { apiFetch } from '../lib/api';
import {
  downloadSampleExcelTemplate,
  exportCurriculumToExcel,
  parseExcelFile,
} from '../lib/excel';

interface ExcelManagerViewProps {
  lessons: LessonItem[];
  onImportSuccess: (lessons: LessonItem[]) => void;
  onRequireAuth?: () => void;
}

export const ExcelManagerView: React.FC<ExcelManagerViewProps> = ({
  lessons,
  onImportSuccess,
  onRequireAuth,
}) => {
  const [parsedRows, setParsedRows] = useState<ExcelImportRow[] | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [selectedFileName, setSelectedFileName] = useState<string>('');
  const [importMode, setImportMode] = useState<'append' | 'replace'>('append');
  const [isSaving, setIsSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const totalExercises = lessons.reduce((sum, l) => sum + l.exercises.length, 0);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setStatusMessage(null);
    setSelectedFileName(file.name);

    try {
      const result = await parseExcelFile(file);
      setParsedRows(result.rows);
      setWarnings(result.warnings);
      if (result.rows.length === 0) {
        setStatusMessage({
          type: 'error',
          text: 'Không tìm thấy dòng dữ liệu hợp lệ trong file Excel. Hãy tải file mẫu để xem cấu trúc cột.',
        });
      }
    } catch {
      setStatusMessage({
        type: 'error',
        text: 'Không đọc được file Excel. Vui lòng kiểm tra định dạng .xlsx, .xls hoặc .csv.',
      });
    }
  };

  const handleSaveImport = async () => {
    if (!parsedRows || parsedRows.length === 0) return;
    setIsSaving(true);
    setStatusMessage(null);
    try {
      const res = await apiFetch('/api/curriculum/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: parsedRows, mode: importMode }),
      });
      const data = await res.json();
      if (res.status === 401) {
        onRequireAuth?.();
        throw new Error(data.error || 'Vui lòng đăng nhập để lưu dữ liệu Excel.');
      }
      if (!res.ok) {
        throw new Error(data.error || 'Lỗi lưu dữ liệu');
      }
      onImportSuccess(data.lessons);
      setParsedRows(null);
      setSelectedFileName('');
      setStatusMessage({
        type: 'success',
        text: `Đã nhập thành công ${data.importedCount} câu hỏi từ Excel vào hệ thống!`,
      });
    } catch (err) {
      setStatusMessage({
        type: 'error',
        text: (err as Error).message || 'Không thể lưu dữ liệu Excel.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleResetDefault = async () => {
    setIsSaving(true);
    setStatusMessage(null);
    try {
      const res = await apiFetch('/api/curriculum/reset', { method: 'POST' });
      const data = await res.json();
      if (res.status === 401) {
        onRequireAuth?.();
        throw new Error(data.error || 'Vui lòng đăng nhập để khôi phục dữ liệu.');
      }
      if (!res.ok) throw new Error(data.error || 'Lỗi khôi phục');
      onImportSuccess(data.lessons);
      setConfirmReset(false);
      setStatusMessage({
        type: 'success',
        text: 'Đã khôi phục bộ dữ liệu 5 cấp độ Cơ Ho mặc định.',
      });
    } catch (err) {
      setStatusMessage({
        type: 'error',
        text: (err as Error).message || 'Không thể khôi phục dữ liệu.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-stone-900 text-balance">
          Quản lý dữ liệu học tập từ Excel
        </h2>
        <p className="text-sm sm:text-base text-stone-600 max-w-2xl">
          Giáo viên có thể tải lên file Excel (.xlsx, .xls, .csv) sẵn có để cập nhật từ vựng, câu hỏi, link âm thanh cho cả 5 cấp độ khó.
        </p>
      </div>

      {/* Summary & Quick Export/Template Actions */}
      <div className="bg-white border border-stone-200 rounded-2xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="text-sm font-bold text-stone-900">Kho bài học hiện tại</div>
            <div className="text-xs text-stone-600 tabular-nums">
              {lessons.length} bài học · {totalExercises} câu hỏi thực hành · 5 cấp độ
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={downloadSampleExcelTemplate}
              className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-stone-800 bg-stone-100 hover:bg-stone-200 rounded-xl min-h-[44px] whitespace-nowrap"
            >
              <FileSpreadsheet className="w-4 h-4 text-emerald-700" />
              <span>Tải file Excel mẫu</span>
            </button>

            <button
              type="button"
              onClick={() => exportCurriculumToExcel(lessons)}
              className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 rounded-xl min-h-[44px] whitespace-nowrap"
            >
              <Download className="w-4 h-4" />
              <span>Xuất dữ liệu ra Excel</span>
            </button>
          </div>
        </div>
      </div>

      {/* Upload Box */}
      <div className="bg-white border border-stone-200 rounded-2xl p-5 sm:p-6 space-y-5">
        <label className="flex flex-col items-center justify-center border-2 border-dashed border-stone-300 hover:border-emerald-500 rounded-2xl p-6 sm:p-8 text-center cursor-pointer transition-colors bg-stone-50/50">
          <Upload className="w-9 h-9 text-emerald-700 mb-3" />
          <span className="text-base font-bold text-stone-900">
            {selectedFileName ? `Đã chọn: ${selectedFileName}` : 'Chọn file Excel từ máy tính hoặc điện thoại'}
          </span>
          <span className="text-xs text-stone-500 mt-1">
            Hỗ trợ định dạng .xlsx, .xls, .csv · Cột chuẩn: Cấp độ, Tên bài học, Kỹ năng, Câu hỏi, Chữ Cơ Ho, Nghĩa tiếng Việt, Các lựa chọn, Đáp án đúng
          </span>
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={handleFileChange}
            className="sr-only"
          />
        </label>

        {statusMessage && (
          <div
            className={`flex items-start gap-3 p-4 rounded-2xl border text-sm ${
              statusMessage.type === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                : 'bg-rose-50 border-rose-200 text-rose-900'
            }`}
          >
            {statusMessage.type === 'success' ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
            )}
            <span className="font-medium">{statusMessage.text}</span>
          </div>
        )}

        {warnings.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-xs text-amber-900 space-y-1">
            <div className="font-bold">Lưu ý khi đọc file Excel:</div>
            {warnings.slice(0, 5).map((w, i) => (
              <div key={i}>{w}</div>
            ))}
          </div>
        )}

        {/* Preview Table */}
        {parsedRows && parsedRows.length > 0 && (
          <div className="space-y-4 pt-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm font-bold text-stone-900">
                Xem trước {parsedRows.length} câu hỏi chuẩn bị nhập
              </div>
              <div className="flex items-center gap-1.5 p-1 bg-stone-100 rounded-xl">
                <button
                  type="button"
                  onClick={() => setImportMode('append')}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg min-h-[36px] ${
                    importMode === 'append' ? 'bg-white text-stone-900 shadow-xs' : 'text-stone-600'
                  }`}
                >
                  Thêm vào bài hiện có
                </button>
                <button
                  type="button"
                  onClick={() => setImportMode('replace')}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg min-h-[36px] ${
                    importMode === 'replace' ? 'bg-white text-stone-900 shadow-xs' : 'text-stone-600'
                  }`}
                >
                  Thay thế toàn bộ
                </button>
              </div>
            </div>

            <div className="overflow-x-auto border border-stone-200 rounded-xl">
              <table className="w-full text-left text-xs">
                <thead className="bg-stone-100 text-stone-700 font-semibold">
                  <tr>
                    <th className="p-3">Cấp độ</th>
                    <th className="p-3">Bài học</th>
                    <th className="p-3">Kỹ năng</th>
                    <th className="p-3">Chữ Cơ Ho</th>
                    <th className="p-3">Nghĩa tiếng Việt</th>
                    <th className="p-3">Đáp án</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {parsedRows.slice(0, 10).map((row, idx) => (
                    <tr key={idx} className="bg-white">
                      <td className="p-3 font-mono font-bold text-emerald-700">Cấp {row.level}</td>
                      <td className="p-3 font-medium text-stone-900">{row.lessonTitle}</td>
                      <td className="p-3 text-stone-600">{row.skill}</td>
                      <td className="p-3 font-bold text-stone-900">{row.cohoText}</td>
                      <td className="p-3 text-stone-600">{row.vietnameseText}</td>
                      <td className="p-3 text-emerald-800 font-semibold">{row.correctAnswer}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setParsedRows(null);
                  setSelectedFileName('');
                }}
                className="px-4 py-2.5 text-sm font-semibold text-stone-700 bg-stone-100 hover:bg-stone-200 rounded-xl min-h-[44px]"
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                disabled={isSaving}
                onClick={handleSaveImport}
                className="px-6 py-2.5 text-sm font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-xl border-b-4 border-emerald-900 min-h-[44px]"
              >
                {isSaving ? 'Đang lưu dữ liệu...' : 'Lưu dữ liệu Excel vào hệ thống'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Reset to default curriculum */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-stone-200">
        <div className="text-xs text-stone-500">
          Cần quay lại bộ 15 bài học Cơ Ho 5 cấp độ mặc định?
        </div>
        {!confirmReset ? (
          <button
            type="button"
            onClick={() => setConfirmReset(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-stone-700 bg-white border border-stone-200 hover:bg-stone-50 rounded-xl min-h-[40px]"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Khôi phục dữ liệu mẫu</span>
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-rose-700">Xác nhận khôi phục?</span>
            <button
              type="button"
              onClick={handleResetDefault}
              disabled={isSaving}
              className="px-3 py-1.5 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-lg min-h-[36px]"
            >
              Đồng ý
            </button>
            <button
              type="button"
              onClick={() => setConfirmReset(false)}
              className="px-3 py-1.5 text-xs font-semibold text-stone-700 bg-stone-100 rounded-lg min-h-[36px]"
            >
              Hủy
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
