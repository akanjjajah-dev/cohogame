import express from 'express';
import {
  getAllLessons,
  getStudentProfile,
  importCurriculum,
  recordLessonCompletion,
  resetToSeedCurriculum,
  saveStudentName,
} from './db.ts';
import { ExcelImportRow } from '../shared/types.ts';

export function createApp() {
  const app = express();
  app.use(express.json({ limit: '5mb' }));

  app.get('/api/health', async (_req, res) => {
    try {
      const { lessons, storage } = await getAllLessons();
      res.json({ ok: true, storage, lessonCount: lessons.length });
    } catch (error) {
      res.status(500).json({ ok: false, error: (error as Error).message });
    }
  });

  app.get('/api/curriculum', async (_req, res) => {
    try {
      const data = await getAllLessons();
      res.json(data);
    } catch (error) {
      console.error('Error getting curriculum:', error);
      res.status(500).json({ error: 'Không thể tải danh sách bài học.' });
    }
  });

  app.post('/api/curriculum/import', async (req, res) => {
    try {
      const { rows, mode } = req.body as {
        rows?: ExcelImportRow[];
        mode?: 'append' | 'replace';
      };

      if (!Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({ error: 'Dữ liệu Excel trống hoặc không hợp lệ.' });
      }

      const result = await importCurriculum(rows, mode === 'replace' ? 'replace' : 'append');
      res.json(result);
    } catch (error) {
      console.error('Error importing curriculum:', error);
      res.status(500).json({ error: 'Không thể lưu dữ liệu Excel vào hệ thống.' });
    }
  });

  app.post('/api/curriculum/reset', async (_req, res) => {
    try {
      const result = await resetToSeedCurriculum();
      res.json(result);
    } catch (error) {
      console.error('Error resetting curriculum:', error);
      res.status(500).json({ error: 'Không thể khôi phục dữ liệu mẫu.' });
    }
  });

  app.get('/api/student/:id', async (req, res) => {
    try {
      const profile = await getStudentProfile(req.params.id);
      res.json(profile);
    } catch (error) {
      console.error('Error getting student profile:', error);
      res.status(500).json({ error: 'Không thể tải hồ sơ học sinh.' });
    }
  });

  app.put('/api/student/:id', async (req, res) => {
    try {
      const { displayName } = req.body as { displayName?: string };
      if (!displayName || typeof displayName !== 'string') {
        return res.status(400).json({ error: 'Tên học sinh không hợp lệ.' });
      }
      const profile = await saveStudentName(req.params.id, displayName);
      res.json(profile);
    } catch (error) {
      console.error('Error updating student profile:', error);
      res.status(500).json({ error: 'Không thể cập nhật tên học sinh.' });
    }
  });

  app.post('/api/student/:id/complete', async (req, res) => {
    try {
      const { lessonId, score, earnedXp, heartsRemaining } = req.body as {
        lessonId?: string;
        score?: number;
        earnedXp?: number;
        heartsRemaining?: number;
      };
      if (!lessonId || typeof score !== 'number' || typeof earnedXp !== 'number') {
        return res.status(400).json({ error: 'Thiếu thông tin hoàn thành bài học.' });
      }
      const profile = await recordLessonCompletion({
        studentId: req.params.id,
        lessonId,
        score,
        earnedXp,
        heartsRemaining: typeof heartsRemaining === 'number' ? heartsRemaining : 5,
      });
      res.json(profile);
    } catch (error) {
      console.error('Error completing lesson:', error);
      res.status(500).json({ error: 'Không thể lưu tiến độ học tập.' });
    }
  });

  return app;
}
