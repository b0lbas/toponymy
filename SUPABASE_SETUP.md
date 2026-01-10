# Supabase Setup для Pattern Admin System

## Шаг 1: Зайти в Supabase

1. Откройте https://supabase.com/
2. Зайдите в ваш проект: https://app.supabase.com/
3. Откройте **SQL Editor** в левом меню

## Шаг 2: Запустить миграцию

1. Нажмите "+ New Query"
2. Скопируйте содержимое файла `supabase_migration.sql` (весь текст)
3. Вставьте в SQL Editor
4. Нажмите "▶ Run" (зелёная кнопка)

Должны быть созданы две таблицы:
- `hidden_patterns` — паттерны которые скрыты
- `pattern_reports` — репорты от пользователей

## Шаг 3: Проверить Service Role Key

1. Откройте **Settings** → **API**
2. Скопируйте `service_role` (это ваш Service Role Secret Key)
3. Вставьте его в `.env` файл как `SUPABASE_SERVICE_ROLE_KEY`

**⚠️ ВАЖНО:** Service Role Key надо хранить в безопасности! Не коммитьте в git.

## Шаг 4: Проверить таблицы

1. Откройте **Table Editor** в левом меню
2. Вы должны увидеть две новые таблицы:
   - `pattern_reports` (с колонками: id, country_id, pattern, user_id, reason, comment, status, created_at, updated_at)
   - `hidden_patterns` (с колонками: id, country_id, pattern, created_at)

## Шаг 5: Настроить Environment Variables

### На сервере (в `.env` или на хостинге):
```
ADMIN_USER_ID=user_1767857068696
SUPABASE_URL=https://qmbntgekxlcxxingygyc.supabase.co
SUPABASE_ANON_KEY=sb_publishable_9Js3Bf-wdQCi-VP_8B9uqA_kaxY3WpO
SUPABASE_SERVICE_ROLE_KEY=<ваш service role key>
CORS_ORIGIN=http://localhost:3000 (или ваш production domain)
JWT_SECRET=<ваш существующий secret>
```

### На Vercel:
1. Settings → Environment Variables
2. Добавьте:
   - `ADMIN_USER_ID` = `user_1767857068696`
   - `SUPABASE_SERVICE_ROLE_KEY` = `<ваш service role key>`
   - (остальные ключи уже там)

## Шаг 6: Готово!

Теперь вся система работает:
- ✅ Пользователи могут репортить паттерны
- ✅ Админ (вы) можете видеть репорты в панели
- ✅ Можно принимать (Accept) или отклонять (Reject) репорты
- ✅ Принятые паттерны автоматически скрываются на сайте

## Troubleshooting

**Q: Не вижу кнопку Admin в интерфейсе**
A: Нужно быть авторизованным как администратор (user_1767857068696). Зайдите на сайт, авторизуйтесь.

**Q: Report кнопка не работает**
A: Проверьте что:
1. Вы авторизованы
2. В браузере откройте DevTools → Console
3. Проверьте что URL API правильный (http://localhost:3000/api/patterns/report)

**Q: Админ-панель не загружает репорты**
A: Проверьте:
1. ADMIN_USER_ID совпадает с вашим user_id
2. SUPABASE_SERVICE_ROLE_KEY правильный
3. Таблица pattern_reports существует в Supabase
4. DevTools → Network → проверьте запрос к /api/admin/reports

## API Endpoints

```
# Report pattern (авторизованный пользователь)
POST /api/patterns/report
Authorization: Bearer {jwt_token}
{
  "country_id": "12",
  "pattern": "-ium",
  "comment": "Bad pattern"
}

# Get hidden patterns (публичный)
GET /api/patterns/hidden?country_id=12

# Get pending reports (только админ)
GET /api/admin/reports
Authorization: Bearer {jwt_token}

# Submit verdict (только админ)
POST /api/admin/verdict?id={reportId}
Authorization: Bearer {jwt_token}
{
  "decision": "accept" | "reject"
}
```
