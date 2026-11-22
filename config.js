'use strict';
// Verbindung zum Supabase-Projekt.
// Der anon/publishable key ist absichtlich öffentlich: Was jemand damit darf, regeln die
// Row-Level-Security-Regeln in supabase/schema.sql. Den service_role/secret key NIE hier eintragen!
window.CN_CONFIG = Object.freeze({
  SUPABASE_URL: '__SUPABASE_URL__',
  SUPABASE_KEY: '__SUPABASE_KEY__',
  // Muss mit public.cn_email_domain() in supabase/schema.sql übereinstimmen
  EMAIL_DOMAIN: 'users.charakter-netz.app',
});
