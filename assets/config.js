/* Pengaturan server login (Supabase).
 * Isi dua nilai di bawah dari Supabase > Project Settings > API:
 *   supabaseUrl     = "Project URL"        contoh: https://abcdefgh.supabase.co
 *   supabaseAnonKey = "anon public" key    (boleh terlihat publik, aman)
 * JANGAN PERNAH mengisi "service_role" key di sini.
 */
window.TBR_CONFIG = {
  supabaseUrl: "https://buylnejtpqwwaqjxecxy.supabase.co/rest/v1/",
  supabaseAnonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ1eWxuZWp0cHF3d2FxanhlY3h5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTUxNzMzMzksImV4cCI6MjExMDc0OTMzOX0.payrxY6R0w-NtSP2tjjGQ39GTEen0dxDnVDvR273wKQ",
  // akhiran email internal untuk username (tidak ada email yang dikirim)
  emailDomain: "users.tbr11.example.com"
};
