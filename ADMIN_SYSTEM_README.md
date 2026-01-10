# Pattern Admin System

## Setup Instructions

### 1. Supabase Database Migration

Run the SQL migration in your Supabase dashboard (SQL Editor):

```bash
# Copy and paste the contents of supabase_migration.sql into Supabase SQL Editor
# This creates the following tables:
# - pattern_reports: User reports of bad patterns
# - hidden_patterns: Patterns hidden by admin
```

### 2. Environment Variables

Add to your `.env.local` or server `.env`:

```
# Backend / API
ADMIN_USER_ID=your-supabase-user-id-here
JWT_SECRET=your-secret-key-here
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
SUPABASE_ANON_KEY=your-anon-key

# Frontend
REACT_APP_ADMIN_USER_ID=your-user-id
```

### 3. Get Your User ID

1. Sign in on the web app
2. Look in browser console: `localStorage.getItem('auth_token')` and decode the JWT
3. Or get it from Supabase dashboard → Authentication → Users

### 4. API Endpoints

**Report a Pattern (authenticated)**
```
POST /api/patterns/report
Authorization: Bearer {token}
Content-Type: application/json

{
  "country_id": "12",
  "pattern": "-ium",
  "reason": "spam",
  "comment": "Too many false positives"
}
```

**Get Pending Reports (admin only)**
```
GET /api/admin/reports
Authorization: Bearer {token}
```

**Submit Verdict (admin only)**
```
POST /api/admin/verdict?id={reportId}
Authorization: Bearer {token}
Content-Type: application/json

{
  "decision": "accept" | "reject"
}
```

**Get Hidden Patterns for Country**
```
GET /api/patterns/hidden?country_id=12
```

### 5. Frontend Integration

The UI includes:
- **Report button** on each pattern (yellow button)
- **Admin panel** at `/admin` (visible only for admin user)
- **Admin dashboard** to review and approve/reject reports

### 6. How It Works

1. Users see patterns on the map
2. Can click "Report" button on any pattern
3. Modal appears to add comment (optional)
4. Report sent to database with user_id, pattern, country_id
5. Admin sees pending reports in `/admin` page
6. Admin can "Accept" (hides pattern) or "Reject" (keeps pattern visible)
7. Accepted patterns are added to `hidden_patterns` table
8. Hidden patterns are filtered out when loading patterns.json

### 7. Filtering on Frontend

When loading patterns, the frontend should:
```typescript
// After fetching patterns.json
const { data: hiddenRes } = await fetch(`/api/patterns/hidden?country_id=${countryId}`)
const hidden = new Set(hiddenRes.hidden || [])
const filteredPatterns = patterns.filter(p => !hidden.has(p.pattern))
```

This is not yet implemented — add it to `CountryPanel.tsx` or `lib/data.ts`.

### 8. Testing

1. Sign in as a user
2. Find a pattern, click "Report"
3. Submit report with optional comment
4. Sign in as admin (if different user)
5. Go to `/admin`
6. Review report with map preview
7. Click "Accept" to hide, or "Reject" to keep
8. Pattern should disappear from main view (after frontend filter added)
