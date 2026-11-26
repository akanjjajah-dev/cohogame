export type DifficultyLevel = 1 | 2 | 3 | 4 | 5;

export type SkillType = 'recognize' | 'listen' | 'read' | 'write';

export type ExerciseType =
  | 'multiple_choice'
  | 'listen_select'
  | 'word_bank'
  | 'type_coho'
  | 'handwriting'
  | 'speak_read';

export interface ExerciseItem {
  id: string;
  lessonId: string;
  orderIndex: number;
  skill: SkillType;
  exerciseType: ExerciseType;
  prompt: string;
  cohoText: string;
  vietnameseText: string;
  phonetic: string;
  options: string[];
  correctAnswer: string;
  audioUrl: string;
  hint: string;
}

export interface LessonItem {
  id: string;
  level: DifficultyLevel;
  orderIndex: number;
  title: string;
  description: string;
  xpReward: number;
  exercises: ExerciseItem[];
}

export interface StudentProgressItem {
  lessonId: string;
  stars: number; // 0..3
  bestScore: number; // 0..100
  completedAt: string;
}

export interface StudentProfile {
  id: string;
  displayName: string;
  xp: number;
  streak: number;
  hearts: number;
  dailyGoalXp: number;
  todayXp: number;
  lastActiveDate: string;
  progress: Record<string, StudentProgressItem>;
}

export interface AlphabetEntry {
  char: string;
  name: string;
  soundGuide: string;
  exampleWord: string;
  exampleMeaning: string;
  category: 'vowel' | 'special_consonant' | 'consonant';
}

export interface ExcelImportRow {
  level: DifficultyLevel;
  lessonTitle: string;
  lessonDescription?: string;
  skill: SkillType;
  exerciseType: ExerciseType;
  prompt: string;
  cohoText: string;
  vietnameseText: string;
  phonetic?: string;
  options?: string[];
  correctAnswer: string;
  audioUrl?: string;
  hint?: string;
}

export interface LevelMeta {
  level: DifficultyLevel;
  title: string;
  subtitle: string;
  badgeText: string;
  accentHex: string;
}

export interface LeaderboardEntry {
  rank: number;
  id: string;
  displayName: string;
  totalScore: number;
  xp: number;
  streak: number;
  completedLessons: number;
  averageScore: number;
  lastActiveDate: string;
}

export interface AuthUser {
  id: string;
  username: string;
  email: string;
  studentId: string;
  createdAt: string;
}

export interface AuthSessionResponse {
  authenticated: boolean;
  user: AuthUser | null;
  profile: StudentProfile | null;
}

export type ChatTopicId =
  | 'daily_life'
  | 'travel'
  | 'food_restaurant'
  | 'school'
  | 'shopping'
  | 'work'
  | 'friendship'
  | 'entertainment';

export type ChatLanguageId = 'en' | 'kho' | 'ja' | 'ko' | 'fr';

export interface ChatTopicMeta {
  id: ChatTopicId;
  title: string;
  titleVi: string;
  descriptionVi: string;
}

export interface ChatLanguageMeta {
  id: ChatLanguageId;
  label: string;
  nativeName: string;
  teacherName: string;
  speechLang: string;
}

export interface ChatCorrectionIssue {
  type: 'grammar' | 'spelling' | 'word_choice';
  explanationVi: string;
}

export interface ChatCorrection {
  hasErrors: boolean;
  correctedText: string;
  issues: ChatCorrectionIssue[];
  naturalSuggestion: string;
  naturalSuggestionVi: string;
  encouragementVi: string;
}

export interface ChatPronunciationFeedback {
  accuracyNoteVi: string;
  mispronouncedWords: string[];
  tipsVi: string;
}

export interface ChatReplySuggestion {
  text: string;
  vietnameseMeaning: string;
}

export interface AiChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: string;
  vietnameseTranslation?: string;
  correction?: ChatCorrection;
  pronunciationFeedback?: ChatPronunciationFeedback;
  spokenViaMic?: boolean;
}

export interface AiChatConversation {
  id: string;
  topicId: ChatTopicId;
  languageId: ChatLanguageId;
  title: string;
  messages: AiChatMessage[];
  suggestions: ChatReplySuggestion[];
  createdAt: string;
  updatedAt: string;
}

