import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  'https://jkkelwpnrgzbvopszwrl.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impra2Vsd3Bucmd6YnZvcHN6d3JsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQxMTA3MzAsImV4cCI6MjA5OTY4NjczMH0.2-8ySikqL7fnwJ60HjOiN6NSgVfGc47Mrouct7NlL8M'
);
