import { createClient } from '@supabase/supabase-js';
import { CONFIG } from './config';

const supabaseUrl = CONFIG.SUPABASE_URL || "https://fopyejijjeoumimsdgiz.supabase.co";
const supabaseAnonKey = CONFIG.SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.unconfigured_dev_key";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);


