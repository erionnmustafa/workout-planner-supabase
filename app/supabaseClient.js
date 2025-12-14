import "react-native-url-polyfill/auto";
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://rqiovuwtwbomuclyejcc.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJxaW92dXd0d2JvbXVjbHllamNjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU3MDUwODgsImV4cCI6MjA4MTI4MTA4OH0.vi4zyJ3EW_DgFoehP1Xu0sXgf98CFlHrhsaSdSgI9zk";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
