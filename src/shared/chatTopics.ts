import { ChatLanguageId, ChatLanguageMeta, ChatTopicId, ChatTopicMeta } from './types';

export const CHAT_TOPICS: ChatTopicMeta[] = [
  {
    id: 'daily_life',
    title: 'Daily Life',
    titleVi: 'Đời sống hằng ngày',
    descriptionVi: 'Thói quen buổi sáng, gia đình, thời tiết và trò chuyện thường ngày.',
  },
  {
    id: 'travel',
    title: 'Travel',
    titleVi: 'Du lịch & Di chuyển',
    descriptionVi: 'Đặt phòng khách sạn, hỏi đường, sân bay và khám phá điểm đến.',
  },
  {
    id: 'food_restaurant',
    title: 'Food & Restaurant',
    titleVi: 'Ẩm thực & Nhà hàng',
    descriptionVi: 'Gọi món, hỏi thành phần món ăn, thanh toán và khẩu vị.',
  },
  {
    id: 'school',
    title: 'School',
    titleVi: 'Trường học & Học tập',
    descriptionVi: 'Lớp học, bài tập, trao đổi với bạn bè và thầy cô.',
  },
  {
    id: 'shopping',
    title: 'Shopping',
    titleVi: 'Mua sắm',
    descriptionVi: 'Hỏi giá, chọn kích cỡ, mặc cả lịch sự và đổi trả hàng.',
  },
  {
    id: 'work',
    title: 'Work',
    titleVi: 'Công việc & Nghề nghiệp',
    descriptionVi: 'Phỏng vấn, họp nhóm, trao đổi tiến độ và giao tiếp công sở.',
  },
  {
    id: 'friendship',
    title: 'Friendship',
    titleVi: 'Tình bạn & Giao lưu',
    descriptionVi: 'Làm quen bạn mới, rủ đi chơi cuối tuần và chia sẻ sở thích.',
  },
  {
    id: 'entertainment',
    title: 'Entertainment',
    titleVi: 'Giải trí & Âm nhạc',
    descriptionVi: 'Phim ảnh, âm nhạc, thể thao, đọc sách và kế hoạch giải trí.',
  },
];

export const CHAT_LANGUAGES: ChatLanguageMeta[] = [
  {
    id: 'en',
    label: 'Tiếng Anh',
    nativeName: 'English',
    teacherName: 'Cô Maya',
    speechLang: 'en-US',
  },
  {
    id: 'kho',
    label: 'Tiếng Cơ Ho (K’Ho)',
    nativeName: 'Nggar K’Ho (Lâm Đồng)',
    teacherName: 'Thầy K’Brê',
    speechLang: 'vi-VN',
  },
  {
    id: 'ja',
    label: 'Tiếng Nhật',
    nativeName: '日本語',
    teacherName: 'Cô Haruka',
    speechLang: 'ja-JP',
  },
  {
    id: 'ko',
    label: 'Tiếng Hàn',
    nativeName: '한국어',
    teacherName: 'Thầy Minho',
    speechLang: 'ko-KR',
  },
  {
    id: 'fr',
    label: 'Tiếng Pháp',
    nativeName: 'Français',
    teacherName: 'Cô Claire',
    speechLang: 'fr-FR',
  },
];

export const CHAT_TOPIC_IDS = new Set<ChatTopicId>(CHAT_TOPICS.map((t) => t.id));
export const CHAT_LANGUAGE_IDS = new Set<ChatLanguageId>(CHAT_LANGUAGES.map((l) => l.id));

export function getChatTopicMeta(topicId: ChatTopicId): ChatTopicMeta {
  return CHAT_TOPICS.find((t) => t.id === topicId) || CHAT_TOPICS[0];
}

export function getChatLanguageMeta(languageId: ChatLanguageId): ChatLanguageMeta {
  return CHAT_LANGUAGES.find((l) => l.id === languageId) || CHAT_LANGUAGES[0];
}
