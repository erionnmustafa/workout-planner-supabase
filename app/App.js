import "react-native-gesture-handler";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
  Linking,
} from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "./supabaseClient";

const Tab = createBottomTabNavigator();
const PH = "#111827";

function prettyAuthError(error) {
  const msg = (error?.message || "").toLowerCase();
  if (msg.includes("invalid login credentials")) return "Email or password is incorrect.";
  if (msg.includes("email not confirmed")) return "Confirm your email first (check inbox).";
  if (msg.includes("password should be at least")) return "Password is too short.";
  if (msg.includes("user already registered")) return "This email is already registered.";
  return error?.message || "Something went wrong.";
}

function dayKey(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.toISOString().slice(0, 10);
}

function startOfWeekISO(d = new Date()) {
  const x = new Date(d);
  const day = x.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  x.setDate(x.getDate() + diff);
  x.setHours(0, 0, 0, 0);
  return x.toISOString();
}

function parsePlan(text) {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

function normalizeCategory(c) {
  const v = (c || "").trim();
  if (!v) return "General";
  return v.slice(0, 32);
}

function extractYouTubeId(url) {
  if (!url) return null;
  const m =
    url.match(/youtu\.be\/([A-Za-z0-9_-]+)/) ||
    url.match(/[?&]v=([A-Za-z0-9_-]+)/) ||
    url.match(/embed\/([A-Za-z0-9_-]+)/) ||
    url.match(/shorts\/([A-Za-z0-9_-]+)/);
  return m?.[1] || null;
}

function buildYouTubeWatchUrl(url) {
  const id = extractYouTubeId(url);
  if (!id) return null;
  return `https://www.youtube.com/watch?v=${id}`;
}

function computeStreakFromDays(daysSet) {
  let s = 0;
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  while (daysSet.has(dayKey(d))) {
    s += 1;
    d.setDate(d.getDate() - 1);
  }
  return s;
}

function computeAchievements({ totalWorkouts, totalCompletions, streakDays, completedThisWeek }) {
  const a = [];
  const add = (id, title, desc, ok) => a.push({ id, title, desc, ok });

  add("first_workout", "First Workout", "Create your first plan.", totalWorkouts >= 1);
  add("first_complete", "First Completion", "Complete a workout once.", totalCompletions >= 1);

  add("week_starter", "Week Starter", "Complete 2 workouts this week.", completedThisWeek >= 2);
  add("week_machine", "Week Machine", "Complete 4 workouts this week.", completedThisWeek >= 4);
  add("week_monster", "Week Monster", "Complete 6 workouts this week.", completedThisWeek >= 6);

  add("streak_3", "3-Day Streak", "Complete workouts 3 days in a row.", streakDays >= 3);
  add("streak_7", "7-Day Streak", "Complete workouts 7 days in a row.", streakDays >= 7);
  add("streak_14", "14-Day Streak", "Complete workouts 14 days in a row.", streakDays >= 14);

  add("complete_10", "10 Completions", "Complete workouts 10 times.", totalCompletions >= 10);
  add("complete_25", "25 Completions", "Complete workouts 25 times.", totalCompletions >= 25);
  add("complete_50", "50 Completions", "Complete workouts 50 times.", totalCompletions >= 50);

  return a;
}

export default function App() {
  const [session, setSession] = useState(null);
  const [loadingSession, setLoadingSession] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoadingSession(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (loadingSession) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator size="large" />
      </SafeAreaView>
    );
  }

  if (!session) return <AuthScreen />;

  return (
    <NavigationContainer>
      <Tab.Navigator
        screenOptions={({ route }) => ({
          headerShown: false,
          tabBarShowLabel: false,
          tabBarStyle: styles.tabBar,
          tabBarIcon: ({ focused, size }) => {
            const map = {
              Dashboard: focused ? "grid" : "grid-outline",
              Workouts: focused ? "barbell" : "barbell-outline",
              Profile: focused ? "person" : "person-outline",
            };
            return (
              <Ionicons
                name={map[route.name]}
                size={size}
                color={focused ? "#E2E8F0" : "#94A3B8"}
              />
            );
          },
        })}
      >
        <Tab.Screen name="Dashboard">
          {(p) => <DashboardScreen {...p} session={session} />}
        </Tab.Screen>
        <Tab.Screen name="Workouts">
          {(p) => <WorkoutsScreen {...p} session={session} />}
        </Tab.Screen>
        <Tab.Screen name="Profile">
          {(p) => <ProfileScreen {...p} session={session} />}
        </Tab.Screen>
      </Tab.Navigator>
    </NavigationContainer>
  );
}

function AuthScreen() {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const e = email.trim();
    const p = pass;

    if (!e || !p) {
      Alert.alert("Missing info", "Email and password are required.");
      return;
    }

    setBusy(true);

    if (mode === "login") {
      const { error } = await supabase.auth.signInWithPassword({ email: e, password: p });
      if (error) Alert.alert("Login failed", prettyAuthError(error));
    } else {
      const { error } = await supabase.auth.signUp({ email: e, password: p });
      if (error) Alert.alert("Register failed", prettyAuthError(error));
      else {
        Alert.alert("Account created", "Now login with your account.");
        setMode("login");
      }
    }

    setBusy(false);
  };

  return (
    <SafeAreaView style={styles.screen}>
      <LinearGradient colors={["#050816", "#0B1220", "#070A12"]} style={styles.bg} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.authWrap}>
          <View style={styles.brandRow}>
            <View style={styles.brandIcon}>
              <Ionicons name="barbell" size={18} color="#0B1220" />
            </View>
            <Text style={styles.brandText}>Workout Planner</Text>
          </View>

          <Text style={styles.bigTitle}>Train like a system.</Text>
          <Text style={styles.subTitle}>History • Achievements • Timer • Pro-level UX</Text>

          <View style={styles.glassCard}>
            <Text style={styles.cardTitle}>{mode === "login" ? "Login" : "Register"}</Text>

            <TextInput
              placeholder="Email"
              placeholderTextColor={PH}
              style={styles.input}
              autoCapitalize="none"
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
            />
            <TextInput
              placeholder="Password"
              placeholderTextColor={PH}
              style={styles.input}
              secureTextEntry
              value={pass}
              onChangeText={setPass}
            />

            <Pressable style={[styles.primaryBtn, busy && { opacity: 0.7 }]} onPress={submit}>
              <Text style={styles.primaryBtnText}>{busy ? "Processing..." : mode === "login" ? "Login" : "Create account"}</Text>
              <Ionicons name="arrow-forward" size={16} color="#0B1220" />
            </Pressable>

            <Pressable onPress={() => setMode(mode === "login" ? "register" : "login")}>
              <Text style={styles.linkCenter}>{mode === "login" ? "No account? Register" : "Already have an account? Login"}</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function DashboardScreen({ session, navigation }) {
  const user = session.user;

  const [loading, setLoading] = useState(true);
  const [fullName, setFullName] = useState("");

  const [totalWorkouts, setTotalWorkouts] = useState(0);
  const [totalCompletions, setTotalCompletions] = useState(0);

  const [completedThisWeek, setCompletedThisWeek] = useState(0);
  const [lastCompletedName, setLastCompletedName] = useState("-");
  const [lastCompletedDate, setLastCompletedDate] = useState("-");
  const [streakDays, setStreakDays] = useState(0);

  const [achievements, setAchievements] = useState([]);

  const load = async () => {
    setLoading(true);

    const { data: prof } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("user_id", user.id)
      .maybeSingle();

    setFullName(prof?.full_name || "");

    const { data: wRows } = await supabase
      .from("workouts")
      .select("id,name,category,completed_at,created_at")
      .eq("user_id", user.id);

    const workouts = wRows || [];
    setTotalWorkouts(workouts.length);

    const weekStart = startOfWeekISO(new Date());
    const { data: lRows } = await supabase
      .from("workout_logs")
      .select("id,workout_id,completed_at")
      .eq("user_id", user.id)
      .order("completed_at", { ascending: false });

    const logs = lRows || [];
    setTotalCompletions(logs.length);

    const weekCount = logs.filter((x) => x.completed_at >= weekStart).length;
    setCompletedThisWeek(weekCount);

    const lastLog = logs[0];
    if (lastLog?.workout_id) {
      const hit = workouts.find((w) => String(w.id) === String(lastLog.workout_id));
      setLastCompletedName(hit?.name || "-");
      setLastCompletedDate(lastLog.completed_at ? new Date(lastLog.completed_at).toLocaleDateString() : "-");
    } else {
      setLastCompletedName("-");
      setLastCompletedDate("-");
    }

    const daysSet = new Set(logs.map((x) => dayKey(x.completed_at)));
    const streak = computeStreakFromDays(daysSet);
    setStreakDays(streak);

    setAchievements(
      computeAchievements({
        totalWorkouts: workouts.length,
        totalCompletions: logs.length,
        streakDays: streak,
        completedThisWeek: weekCount,
      })
    );

    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const earnedCount = achievements.filter((x) => x.ok).length;

  return (
    <SafeAreaView style={styles.screen}>
      <LinearGradient colors={["#050816", "#0B1220", "#070A12"]} style={styles.bg} />
      <View style={styles.page}>
        <View style={styles.topRow}>
          <View>
            <Text style={styles.hiDark}>Welcome{fullName ? `, ${fullName}` : ""}</Text>
            <Text style={styles.smallDark} numberOfLines={1}>{user.email}</Text>
          </View>

          <Pressable style={styles.iconBtnDark} onPress={load}>
            <Ionicons name="refresh-outline" size={18} color="#E2E8F0" />
          </Pressable>
        </View>

        <View style={styles.heroPanelDark}>
          <Text style={styles.heroTitleDark}>Performance System</Text>
          <Text style={styles.heroQuoteDark}>Log it. Track it. Level up.</Text>

          <View style={styles.heroActions}>
            <Pressable style={styles.neonChip} onPress={() => navigation.navigate("Workouts")}>
              <Ionicons name="barbell-outline" size={18} color="#0B1220" />
              <Text style={styles.neonChipText}>Go to Workouts</Text>
            </Pressable>
            <Pressable style={styles.neonChipPink} onPress={() => navigation.navigate("Profile")}>
              <Ionicons name="sparkles-outline" size={18} color="#0B1220" />
              <Text style={styles.neonChipText}>Achievements</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.statsGrid}>
          <Pressable style={styles.statBoxDark} onPress={() => navigation.navigate("Workouts")}>
            <View style={styles.statTop}>
              <Text style={styles.statLabelDark}>Total workouts</Text>
              <Ionicons name="barbell-outline" size={18} color="#E2E8F0" />
            </View>
            <Text style={styles.statValueDark}>{loading ? "..." : String(totalWorkouts)}</Text>
            <Text style={styles.tapHint}>Tap to view</Text>
          </Pressable>

          <View style={styles.statBoxDark}>
            <View style={styles.statTop}>
              <Text style={styles.statLabelDark}>Completed this week</Text>
              <Ionicons name="calendar-outline" size={18} color="#E2E8F0" />
            </View>
            <Text style={styles.statValueDark}>{loading ? "..." : String(completedThisWeek)}</Text>
            <Text style={styles.tapHint}>From workout logs</Text>
          </View>

          <View style={styles.statBoxDark}>
            <View style={styles.statTop}>
              <Text style={styles.statLabelDark}>Streak (days)</Text>
              <Ionicons name="flame-outline" size={18} color="#E2E8F0" />
            </View>
            <Text style={styles.statValueDark}>{loading ? "..." : String(streakDays)}</Text>
            <Text style={styles.tapHint}>Based on completions</Text>
          </View>

          <View style={styles.statBoxDark}>
            <View style={styles.statTop}>
              <Text style={styles.statLabelDark}>Achievements</Text>
              <Ionicons name="trophy-outline" size={18} color="#E2E8F0" />
            </View>
            <Text style={styles.statValueDark}>{loading ? "..." : `${earnedCount}/${achievements.length}`}</Text>
            <Text style={styles.tapHint}>Earned badges</Text>
          </View>

          <View style={styles.statWideDark}>
            <View style={styles.statTop}>
              <Text style={styles.statLabelDark}>Last completed</Text>
              <Ionicons name="time-outline" size={18} color="#E2E8F0" />
            </View>
            <Text style={styles.statValueDark} numberOfLines={1}>{loading ? "..." : lastCompletedName}</Text>
            <Text style={styles.tapHint}>{loading ? "..." : lastCompletedDate}</Text>
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

function WorkoutsScreen({ session }) {
  const user = session.user;

  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const [name, setName] = useState("");
  const [category, setCategory] = useState("General");
  const [planText, setPlanText] = useState("");
  const [videoUrl, setVideoUrl] = useState("");

  const [detailsOpen, setDetailsOpen] = useState(false);
  const [selected, setSelected] = useState(null);

  const [timerOpen, setTimerOpen] = useState(false);
  const [timerSecs, setTimerSecs] = useState(90);

  const plan = useMemo(() => parsePlan(planText), [planText]);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("workouts")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    if (error) Alert.alert("Load failed", error.message);
    setItems(data || []);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const categories = useMemo(() => {
    const set = new Set((items || []).map((x) => normalizeCategory(x.category)));
    return ["all", ...Array.from(set).sort((a, b) => a.localeCompare(b))];
  }, [items]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (items || [])
      .filter((w) => {
        const cat = normalizeCategory(w.category);
        if (categoryFilter !== "all" && cat !== categoryFilter) return false;

        const isCompleted = !!w.completed_at;
        if (statusFilter === "completed" && !isCompleted) return false;
        if (statusFilter === "planned" && isCompleted) return false;

        if (!s) return true;
        return (
          (w.name || "").toLowerCase().includes(s) ||
          cat.toLowerCase().includes(s) ||
          (w.plan || []).join(" ").toLowerCase().includes(s)
        );
      })
      .slice();
  }, [items, search, categoryFilter, statusFilter]);

  const openCreate = () => {
    setEditing(null);
    setName("");
    setCategory("General");
    setPlanText("");
    setVideoUrl("");
    setEditorOpen(true);
  };

  const openEdit = (w) => {
    setEditing(w);
    setName(w.name || "");
    setCategory(normalizeCategory(w.category));
    setPlanText((w.plan || []).join("\n"));
    setVideoUrl(w.video_url || "");
    setEditorOpen(true);
  };

  const save = async () => {
    const n = name.trim();
    const c = normalizeCategory(category);
    const p = plan;
    const v = videoUrl.trim() || null;

    if (!n) return Alert.alert("Missing", "Enter a workout name.");
    if (p.length === 0) return Alert.alert("Missing", "Add at least 1 plan line.");

    const payload = {
      name: n,
      category: c,
      plan: p,
      video_url: v,
      user_id: user.id,
    };

    if (editing?.id) {
      const { error } = await supabase.from("workouts").update(payload).eq("id", editing.id);
      if (error) return Alert.alert("Update failed", error.message);
    } else {
      const { error } = await supabase.from("workouts").insert(payload);
      if (error) return Alert.alert("Create failed", error.message);
    }

    setEditorOpen(false);
    setEditing(null);
    await load();
  };

  const del = (id) => {
    Alert.alert("Delete workout?", "This removes the plan and its history logs.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          const { error } = await supabase.from("workouts").delete().eq("id", id);
          if (error) Alert.alert("Delete failed", error.message);
          await load();
        },
      },
    ]);
  };

  const openDetails = (w) => {
    setSelected(w);
    setDetailsOpen(true);
  };

  const markCompleted = async (w) => {
    const now = new Date().toISOString();

    const { error: e1 } = await supabase.from("workout_logs").insert({
      user_id: user.id,
      workout_id: w.id,
      completed_at: now,
    });

    if (e1) return Alert.alert("Complete failed", e1.message);

    const { error: e2 } = await supabase.from("workouts").update({ completed_at: now }).eq("id", w.id);
    if (e2) return Alert.alert("Complete failed", e2.message);

    Alert.alert("Completed ✅", "Workout added to your history.");
    await load();

    const updated = (items || []).find((x) => x.id === w.id);
    setSelected(updated || { ...w, completed_at: now });
  };

  const shareWorkout = async (w) => {
    const text =
      `Workout: ${w.name}\n` +
      `Category: ${normalizeCategory(w.category)}\n\n` +
      `${(w.plan || []).map((x, i) => `${i + 1}. ${x}`).join("\n")}\n\n` +
      (w.video_url ? `Video: ${w.video_url}\n` : "");
    try {
      await Share.share({ message: text });
    } catch {
      Alert.alert("Share failed", "Could not open share dialog.");
    }
  };

  const openVideo = async (w) => {
    const url = buildYouTubeWatchUrl(w.video_url);
    if (!url) return Alert.alert("Invalid link", "Paste a valid YouTube URL.");
    Linking.openURL(url);
  };

  const startTimer = (secs) => {
    setTimerSecs(secs);
    setTimerOpen(true);
  };

  return (
    <SafeAreaView style={styles.screen}>
      <LinearGradient colors={["#050816", "#0B1220", "#070A12"]} style={styles.bg} />
      <View style={styles.page}>
        <View style={styles.topRow}>
          <View>
            <Text style={styles.hiDark}>Workouts</Text>
            <Text style={styles.smallDark}>Search • Filters • Details • History • Timer</Text>
          </View>
          <Pressable style={styles.fabDark} onPress={openCreate}>
            <Ionicons name="add" size={22} color="#0B1220" />
          </Pressable>
        </View>

        <View style={styles.searchBox}>
          <Ionicons name="search-outline" size={16} color="#94A3B8" />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search workouts, plan, category..."
            placeholderTextColor="#64748b"
            style={styles.searchInput}
          />
          {!!search && (
            <Pressable onPress={() => setSearch("")}>
              <Ionicons name="close-circle" size={18} color="#94A3B8" />
            </Pressable>
          )}
        </View>

        <View style={styles.filterRow}>
          <Pressable
            style={[styles.filterChip, statusFilter === "all" && styles.filterChipOn]}
            onPress={() => setStatusFilter("all")}
          >
            <Text style={[styles.filterText, statusFilter === "all" && styles.filterTextOn]}>All</Text>
          </Pressable>
          <Pressable
            style={[styles.filterChip, statusFilter === "planned" && styles.filterChipOn]}
            onPress={() => setStatusFilter("planned")}
          >
            <Text style={[styles.filterText, statusFilter === "planned" && styles.filterTextOn]}>Planned</Text>
          </Pressable>
          <Pressable
            style={[styles.filterChip, statusFilter === "completed" && styles.filterChipOn]}
            onPress={() => setStatusFilter("completed")}
          >
            <Text style={[styles.filterText, statusFilter === "completed" && styles.filterTextOn]}>Completed</Text>
          </Pressable>
        </View>

        <View style={styles.filterRowWrap}>
          {categories.slice(0, 6).map((c) => (
            <Pressable
              key={c}
              style={[styles.filterChipMini, categoryFilter === c && styles.filterChipMiniOn]}
              onPress={() => setCategoryFilter(c)}
            >
              <Text style={[styles.filterTextMini, categoryFilter === c && styles.filterTextMiniOn]}>
                {c === "all" ? "All Categories" : c}
              </Text>
            </Pressable>
          ))}
          {categories.length > 6 && (
            <View style={styles.moreHint}>
              <Text style={styles.moreHintText}>+{categories.length - 6} more categories</Text>
            </View>
          )}
        </View>

        {loading ? (
          <View style={styles.centerGrow}>
            <ActivityIndicator />
          </View>
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={(x) => String(x.id)}
            contentContainerStyle={{ paddingBottom: 110 }}
            ListEmptyComponent={
              <View style={styles.emptyCardDark}>
                <Ionicons name="barbell-outline" size={28} color="#E2E8F0" />
                <Text style={styles.emptyTitleDark}>No results</Text>
                <Text style={styles.emptySubDark}>Try another search or create a workout.</Text>
                <Pressable style={styles.primaryBtn} onPress={openCreate}>
                  <Text style={styles.primaryBtnText}>Create workout</Text>
                </Pressable>
              </View>
            }
            renderItem={({ item }) => {
              const isCompleted = !!item.completed_at;
              return (
                <Pressable onPress={() => openDetails(item)} style={styles.workoutCardDark}>
                  <View style={styles.workoutHeaderRow}>
                    <View style={styles.workoutTitleCol}>
                      <Text style={styles.workoutTitleDark} numberOfLines={1}>{item.name}</Text>
                      <Text style={styles.smallDark} numberOfLines={1}>
                        {normalizeCategory(item.category)} • {(item.plan || []).length} lines
                      </Text>
                    </View>
                    <View style={[styles.badge, isCompleted ? styles.badgeOn : styles.badgeOff]}>
                      <Text style={[styles.badgeText, isCompleted ? styles.badgeTextOn : styles.badgeTextOff]}>
                        {isCompleted ? "Completed" : "Planned"}
                      </Text>
                    </View>
                  </View>

                  <Text style={styles.previewText} numberOfLines={2}>
                    {(item.plan || []).join(" • ")}
                  </Text>

                  <View style={styles.quickRow}>
                    <Pressable style={styles.quickBtn} onPress={() => markCompleted(item)}>
                      <Ionicons name="checkmark-circle-outline" size={18} color="#0B1220" />
                      <Text style={styles.quickText}>Complete</Text>
                    </Pressable>

                    <Pressable style={styles.quickBtnPink} onPress={() => startTimer(90)}>
                      <Ionicons name="timer-outline" size={18} color="#0B1220" />
                      <Text style={styles.quickText}>Timer</Text>
                    </Pressable>

                    <Pressable style={styles.quickBtnGhost} onPress={() => openEdit(item)}>
                      <Ionicons name="create-outline" size={18} color="#E2E8F0" />
                      <Text style={styles.quickTextGhost}>Edit</Text>
                    </Pressable>
                  </View>
                </Pressable>
              );
            }}
          />
        )}
      </View>

      <Modal visible={editorOpen} animationType="slide">
        <SafeAreaView style={styles.screen}>
          <LinearGradient colors={["#050816", "#0B1220", "#070A12"]} style={styles.bg} />
          <View style={styles.page}>
            <View style={styles.editorHeader}>
              <Pressable style={styles.iconBtnDark} onPress={() => setEditorOpen(false)}>
                <Ionicons name="close" size={18} color="#E2E8F0" />
              </Pressable>
              <Text style={styles.editorTitleDark}>{editing ? "Edit workout" : "New workout"}</Text>
              <View style={{ width: 44 }} />
            </View>

            <View style={styles.glassCardDark}>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="Workout name"
                placeholderTextColor={PH}
                style={styles.inputDark}
              />
              <TextInput
                value={category}
                onChangeText={setCategory}
                placeholder="Category (Push / Pull / Legs / Full Body)"
                placeholderTextColor={PH}
                style={styles.inputDark}
              />
              <TextInput
                value={planText}
                onChangeText={setPlanText}
                placeholder={"Plan (one per line)\nBench Press 3x8\nIncline DB Press 3x10"}
                placeholderTextColor={PH}
                multiline
                style={[styles.inputDark, { height: 160, textAlignVertical: "top" }]}
              />
              <TextInput
                value={videoUrl}
                onChangeText={setVideoUrl}
                placeholder="YouTube URL (optional)"
                placeholderTextColor={PH}
                autoCapitalize="none"
                style={styles.inputDark}
              />

              <Pressable style={styles.primaryBtn} onPress={save}>
                <Text style={styles.primaryBtnText}>{editing ? "Save changes" : "Create workout"}</Text>
              </Pressable>
            </View>
          </View>
        </SafeAreaView>
      </Modal>

      <Modal visible={detailsOpen} animationType="slide" onRequestClose={() => setDetailsOpen(false)}>
        <SafeAreaView style={styles.screen}>
          <LinearGradient colors={["#050816", "#0B1220", "#070A12"]} style={styles.bg} />
          <View style={styles.page}>
            <View style={styles.editorHeader}>
              <Pressable style={styles.iconBtnDark} onPress={() => setDetailsOpen(false)}>
                <Ionicons name="chevron-down" size={20} color="#E2E8F0" />
              </Pressable>
              <Text style={styles.editorTitleDark}>Workout details</Text>
              <View style={{ width: 44 }} />
            </View>

            {selected ? (
              <View style={styles.detailsCard}>
                <Text style={styles.detailsTitle} numberOfLines={2}>{selected.name}</Text>
                <Text style={styles.detailsMeta}>
                  {normalizeCategory(selected.category)} • {(selected.plan || []).length} lines •{" "}
                  {selected.completed_at ? `Completed: ${new Date(selected.completed_at).toLocaleDateString()}` : "Not completed yet"}
                </Text>

                <View style={styles.detailsPlanBox}>
                  <Text style={styles.detailsPlanTitle}>Plan</Text>
                  {(selected.plan || []).map((x, i) => (
                    <Text key={`${i}-${x}`} style={styles.detailsPlanLine}>
                      {i + 1}. {x}
                    </Text>
                  ))}
                </View>

                <View style={styles.detailsActionsRow}>
                  <Pressable style={styles.quickBtn} onPress={() => markCompleted(selected)}>
                    <Ionicons name="checkmark-circle-outline" size={18} color="#0B1220" />
                    <Text style={styles.quickText}>Complete</Text>
                  </Pressable>

                  <Pressable style={styles.quickBtnPink} onPress={() => startTimer(90)}>
                    <Ionicons name="timer-outline" size={18} color="#0B1220" />
                    <Text style={styles.quickText}>Timer</Text>
                  </Pressable>

                  <Pressable style={styles.quickBtnGhost} onPress={() => shareWorkout(selected)}>
                    <Ionicons name="share-social-outline" size={18} color="#E2E8F0" />
                    <Text style={styles.quickTextGhost}>Share</Text>
                  </Pressable>
                </View>

                <View style={styles.detailsActionsRow}>
                  <Pressable style={styles.quickBtnGhost} onPress={() => openEdit(selected)}>
                    <Ionicons name="create-outline" size={18} color="#E2E8F0" />
                    <Text style={styles.quickTextGhost}>Edit</Text>
                  </Pressable>

                  <Pressable style={[styles.quickBtnDanger]} onPress={() => del(selected.id)}>
                    <Ionicons name="trash-outline" size={18} color="#991b1b" />
                    <Text style={styles.quickTextDanger}>Delete</Text>
                  </Pressable>

                  <Pressable
                    style={[styles.quickBtnGhost, !selected.video_url && { opacity: 0.45 }]}
                    onPress={() => selected.video_url && openVideo(selected)}
                    disabled={!selected.video_url}
                  >
                    <Ionicons name="play-circle-outline" size={18} color="#E2E8F0" />
                    <Text style={styles.quickTextGhost}>{selected.video_url ? "Open video" : "No video"}</Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <View style={styles.centerGrow}>
                <ActivityIndicator />
              </View>
            )}
          </View>
        </SafeAreaView>
      </Modal>

      <RestTimerModal open={timerOpen} initialSeconds={timerSecs} onClose={() => setTimerOpen(false)} />
    </SafeAreaView>
  );
}

function RestTimerModal({ open, initialSeconds, onClose }) {
  const [secs, setSecs] = useState(initialSeconds || 90);
  const [running, setRunning] = useState(false);
  const intervalRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setSecs(initialSeconds || 90);
    setRunning(false);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
    };
  }, [open, initialSeconds]);

  useEffect(() => {
    if (!open) return;

    if (running) {
      intervalRef.current = setInterval(() => {
        setSecs((s) => {
          if (s <= 1) {
            if (intervalRef.current) clearInterval(intervalRef.current);
            intervalRef.current = null;
            setRunning(false);
            Alert.alert("Rest done ✅", "Go for the next set.");
            return 0;
          }
          return s - 1;
        });
      }, 1000);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
    };
  }, [running, open]);

  const mm = String(Math.floor(secs / 60)).padStart(2, "0");
  const ss = String(secs % 60).padStart(2, "0");

  const setPreset = (v) => {
    setRunning(false);
    setSecs(v);
  };

  return (
    <Modal visible={open} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.screen}>
        <LinearGradient colors={["#050816", "#0B1220", "#070A12"]} style={styles.bg} />
        <View style={styles.page}>
          <View style={styles.editorHeader}>
            <Pressable style={styles.iconBtnDark} onPress={onClose}>
              <Ionicons name="close" size={18} color="#E2E8F0" />
            </Pressable>
            <Text style={styles.editorTitleDark}>Rest Timer</Text>
            <View style={{ width: 44 }} />
          </View>

          <View style={styles.timerCard}>
            <Text style={styles.timerTitle}>Recover. Breathe. Then attack.</Text>
            <Text style={styles.timerBig}>{mm}:{ss}</Text>

            <View style={styles.timerPresetRow}>
              <Pressable style={styles.timerPreset} onPress={() => setPreset(60)}>
                <Text style={styles.timerPresetText}>60s</Text>
              </Pressable>
              <Pressable style={styles.timerPreset} onPress={() => setPreset(90)}>
                <Text style={styles.timerPresetText}>90s</Text>
              </Pressable>
              <Pressable style={styles.timerPreset} onPress={() => setPreset(120)}>
                <Text style={styles.timerPresetText}>120s</Text>
              </Pressable>
            </View>

            <View style={styles.timerControlsRow}>
              <Pressable style={styles.timerBtn} onPress={() => setSecs((s) => Math.max(0, s - 10))}>
                <Ionicons name="remove" size={18} color="#0B1220" />
                <Text style={styles.timerBtnText}>-10</Text>
              </Pressable>
              <Pressable style={styles.timerBtnMain} onPress={() => setRunning((r) => !r)}>
                <Ionicons name={running ? "pause" : "play"} size={18} color="#0B1220" />
                <Text style={styles.timerBtnText}>{running ? "Pause" : "Start"}</Text>
              </Pressable>
              <Pressable style={styles.timerBtn} onPress={() => setSecs((s) => Math.min(60 * 30, s + 10))}>
                <Ionicons name="add" size={18} color="#0B1220" />
                <Text style={styles.timerBtnText}>+10</Text>
              </Pressable>
            </View>

            <Pressable style={styles.timerReset} onPress={() => { setRunning(false); setSecs(initialSeconds || 90); }}>
              <Text style={styles.timerResetText}>Reset</Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

function ProfileScreen({ session }) {
  const user = session.user;

  const [loading, setLoading] = useState(true);
  const [fullName, setFullName] = useState("");

  const [goal, setGoal] = useState("Bulk");
  const [weeklyTarget, setWeeklyTarget] = useState("4");
  const [level, setLevel] = useState("Intermediate");

  const [stats, setStats] = useState({ totalWorkouts: 0, totalCompletions: 0, streakDays: 0, completedThisWeek: 0 });
  const [achievements, setAchievements] = useState([]);

  const load = async () => {
    setLoading(true);

    const { data: prof } = await supabase
      .from("profiles")
      .select("full_name, goal, weekly_target, level")
      .eq("user_id", user.id)
      .maybeSingle();

    setFullName(prof?.full_name || "");
    setGoal(prof?.goal || "Bulk");
    setWeeklyTarget(String(prof?.weekly_target ?? 4));
    setLevel(prof?.level || "Intermediate");

    const { data: wRows } = await supabase
      .from("workouts")
      .select("id,created_at")
      .eq("user_id", user.id);

    const workouts = wRows || [];

    const { data: lRows } = await supabase
      .from("workout_logs")
      .select("completed_at")
      .eq("user_id", user.id)
      .order("completed_at", { ascending: false });

    const logs = lRows || [];
    const weekStart = startOfWeekISO(new Date());
    const completedThisWeek = logs.filter((x) => x.completed_at >= weekStart).length;

    const daysSet = new Set(logs.map((x) => dayKey(x.completed_at)));
    const streakDays = computeStreakFromDays(daysSet);

    const s = {
      totalWorkouts: workouts.length,
      totalCompletions: logs.length,
      streakDays,
      completedThisWeek,
    };
    setStats(s);

    setAchievements(
      computeAchievements({
        totalWorkouts: s.totalWorkouts,
        totalCompletions: s.totalCompletions,
        streakDays: s.streakDays,
        completedThisWeek: s.completedThisWeek,
      })
    );

    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const save = async () => {
    const wt = Number(weeklyTarget);
    const cleanWT = Number.isFinite(wt) && wt > 0 && wt <= 14 ? wt : 4;

    const { error } = await supabase.from("profiles").upsert({
      user_id: user.id,
      full_name: fullName || null,
      goal: (goal || "Bulk").slice(0, 20),
      weekly_target: cleanWT,
      level: (level || "Intermediate").slice(0, 20),
      updated_at: new Date().toISOString(),
    });

    if (error) Alert.alert("Save failed", error.message);
    else {
      Alert.alert("Saved", "Profile updated.");
      load();
    }
  };

  const logout = async () => {
    await supabase.auth.signOut();
  };

  const earned = achievements.filter((x) => x.ok);
  const locked = achievements.filter((x) => !x.ok);

  if (loading) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <LinearGradient colors={["#050816", "#0B1220", "#070A12"]} style={styles.bg} />
      <View style={styles.page}>
        <Text style={styles.hiDark}>Profile</Text>
        <Text style={styles.smallDark} numberOfLines={1}>{user.email}</Text>

        <View style={styles.profileCardDark}>
          <TextInput value={fullName} onChangeText={setFullName} placeholder="Full name" placeholderTextColor={PH} style={styles.inputDark} />
          <TextInput value={goal} onChangeText={setGoal} placeholder="Goal (Bulk/Cut/Maintain)" placeholderTextColor={PH} style={styles.inputDark} />
          <TextInput value={weeklyTarget} onChangeText={setWeeklyTarget} placeholder="Weekly target (e.g., 4)" placeholderTextColor={PH} keyboardType="numeric" style={styles.inputDark} />
          <TextInput value={level} onChangeText={setLevel} placeholder="Level (Beginner/Intermediate/Advanced)" placeholderTextColor={PH} style={styles.inputDark} />

          <View style={styles.profileStatsRow}>
            <View style={styles.profileStat}>
              <Text style={styles.profileStatLabel}>Workouts</Text>
              <Text style={styles.profileStatValue}>{stats.totalWorkouts}</Text>
            </View>
            <View style={styles.profileStat}>
              <Text style={styles.profileStatLabel}>Completions</Text>
              <Text style={styles.profileStatValue}>{stats.totalCompletions}</Text>
            </View>
            <View style={styles.profileStat}>
              <Text style={styles.profileStatLabel}>Streak</Text>
              <Text style={styles.profileStatValue}>{stats.streakDays}d</Text>
            </View>
            <View style={styles.profileStat}>
              <Text style={styles.profileStatLabel}>This week</Text>
              <Text style={styles.profileStatValue}>{stats.completedThisWeek}</Text>
            </View>
          </View>

          <Pressable style={styles.primaryBtn} onPress={save}>
            <Text style={styles.primaryBtnText}>Save profile</Text>
          </Pressable>

          <Pressable style={styles.reloadBtn} onPress={load}>
            <Text style={styles.reloadText}>Reload</Text>
          </Pressable>

          <View style={styles.achWrap}>
            <View style={styles.achHeader}>
              <Text style={styles.achTitle}>Achievements</Text>
              <Text style={styles.achCount}>{earned.length}/{achievements.length}</Text>
            </View>

            <Text style={styles.achSection}>Earned</Text>
            {earned.length === 0 ? (
              <Text style={styles.achEmpty}>No badges yet. Complete workouts to unlock.</Text>
            ) : (
              earned.map((x) => (
                <View key={x.id} style={styles.achItemOn}>
                  <Ionicons name="trophy" size={16} color="#0B1220" />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.achItemTitleOn}>{x.title}</Text>
                    <Text style={styles.achItemDescOn}>{x.desc}</Text>
                  </View>
                </View>
              ))
            )}

            <Text style={styles.achSection}>Locked</Text>
            {locked.slice(0, 5).map((x) => (
              <View key={x.id} style={styles.achItemOff}>
                <Ionicons name="lock-closed-outline" size={16} color="#E2E8F0" />
                <View style={{ flex: 1 }}>
                  <Text style={styles.achItemTitleOff}>{x.title}</Text>
                  <Text style={styles.achItemDescOff}>{x.desc}</Text>
                </View>
              </View>
            ))}
          </View>

          <Pressable style={styles.logoutBtn} onPress={logout}>
            <Text style={styles.logoutText}>Logout</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  screen: { flex: 1, backgroundColor: "#050816" },
  bg: { ...StyleSheet.absoluteFillObject },

  center: { flex: 1, justifyContent: "center", alignItems: "center", padding: 16 },
  centerGrow: { flex: 1, justifyContent: "center", alignItems: "center" },
  page: { flex: 1, padding: 16 },

  tabBar: {
    height: 66,
    borderTopWidth: 0,
    backgroundColor: "rgba(2,6,23,0.86)",
    position: "absolute",
    left: 14,
    right: 14,
    bottom: 14,
    borderRadius: 20,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 10 },
  },

  authWrap: { flex: 1, justifyContent: "center", padding: 16 },
  brandRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: 12 },
  brandIcon: { width: 40, height: 40, borderRadius: 16, backgroundColor: "rgba(34,211,238,0.92)", alignItems: "center", justifyContent: "center" },
  brandText: { fontSize: 16, fontWeight: "900", color: "#E2E8F0" },

  bigTitle: { fontSize: 30, fontWeight: "900", textAlign: "center", color: "#E2E8F0" },
  subTitle: { marginTop: 8, fontSize: 13, textAlign: "center", color: "#94A3B8", marginBottom: 14 },

  glassCard: { backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 22, padding: 16, borderWidth: 1, borderColor: "rgba(148,163,184,0.18)" },
  glassCardDark: { backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 22, padding: 16, borderWidth: 1, borderColor: "rgba(148,163,184,0.18)" },

  cardTitle: { fontSize: 16, fontWeight: "900", color: "#E2E8F0", marginBottom: 10 },

  input: { borderWidth: 1, borderColor: "rgba(148,163,184,0.22)", borderRadius: 16, padding: 12, marginBottom: 10, backgroundColor: "rgba(255,255,255,0.92)", color: "#0B1220", fontWeight: "800" },
  inputDark: { borderWidth: 1, borderColor: "rgba(148,163,184,0.22)", borderRadius: 16, padding: 12, marginBottom: 10, backgroundColor: "rgba(255,255,255,0.10)", color: "#E2E8F0", fontWeight: "800" },

  primaryBtn: { backgroundColor: "rgba(34,211,238,0.92)", paddingVertical: 12, borderRadius: 16, alignItems: "center", marginTop: 6, flexDirection: "row", justifyContent: "center", gap: 10 },
  primaryBtnText: { color: "#0B1220", fontWeight: "900" },
  linkCenter: { color: "#E2E8F0", fontWeight: "900", textAlign: "center", marginTop: 12, opacity: 0.9 },

  topRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },

  hiDark: { fontSize: 18, fontWeight: "900", color: "#E2E8F0" },
  smallDark: { fontSize: 12, color: "#94A3B8", marginTop: 2, maxWidth: 300 },

  iconBtnDark: { width: 44, height: 44, borderRadius: 16, backgroundColor: "rgba(255,255,255,0.08)", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(148,163,184,0.16)" },

  heroPanelDark: { backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 22, padding: 16, borderWidth: 1, borderColor: "rgba(148,163,184,0.16)", marginBottom: 14 },
  heroTitleDark: { fontSize: 13, fontWeight: "900", color: "#94A3B8" },
  heroQuoteDark: { marginTop: 8, fontSize: 18, fontWeight: "900", color: "#E2E8F0" },
  heroActions: { flexDirection: "row", gap: 10, marginTop: 12 },

  neonChip: { flex: 1, backgroundColor: "rgba(34,211,238,0.92)", paddingVertical: 10, borderRadius: 16, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8 },
  neonChipPink: { flex: 1, backgroundColor: "rgba(236,72,153,0.92)", paddingVertical: 10, borderRadius: 16, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8 },
  neonChipText: { fontWeight: "900", color: "#0B1220" },

  statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  statBoxDark: { width: "47.5%", backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 20, padding: 14, borderWidth: 1, borderColor: "rgba(148,163,184,0.16)" },
  statWideDark: { width: "100%", backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 20, padding: 14, borderWidth: 1, borderColor: "rgba(148,163,184,0.16)" },
  statTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  statLabelDark: { fontSize: 12, color: "#94A3B8", fontWeight: "900" },
  statValueDark: { marginTop: 10, fontSize: 18, fontWeight: "900", color: "#E2E8F0" },
  tapHint: { marginTop: 8, fontSize: 11, color: "rgba(226,232,240,0.6)", fontWeight: "800" },

  fabDark: { width: 46, height: 46, borderRadius: 16, backgroundColor: "rgba(34,211,238,0.92)", alignItems: "center", justifyContent: "center" },

  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 16,
    paddingHorizontal: 12,
    height: 46,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.16)",
    marginBottom: 10,
  },
  searchInput: { flex: 1, color: "#E2E8F0", fontWeight: "800" },

  filterRow: { flexDirection: "row", gap: 10, marginBottom: 10 },
  filterChip: { flex: 1, height: 40, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.08)", borderWidth: 1, borderColor: "rgba(148,163,184,0.16)" },
  filterChipOn: { backgroundColor: "rgba(34,211,238,0.92)" },
  filterText: { color: "#E2E8F0", fontWeight: "900" },
  filterTextOn: { color: "#0B1220" },

  filterRowWrap: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 10 },
  filterChipMini: { paddingHorizontal: 12, height: 34, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.08)", borderWidth: 1, borderColor: "rgba(148,163,184,0.16)" },
  filterChipMiniOn: { backgroundColor: "rgba(236,72,153,0.92)" },
  filterTextMini: { color: "#E2E8F0", fontWeight: "900", fontSize: 12 },
  filterTextMiniOn: { color: "#0B1220" },
  moreHint: { justifyContent: "center" },
  moreHintText: { color: "#94A3B8", fontWeight: "800", fontSize: 12 },

  emptyCardDark: { marginTop: 30, backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 22, padding: 18, borderWidth: 1, borderColor: "rgba(148,163,184,0.16)", alignItems: "center" },
  emptyTitleDark: { marginTop: 10, fontSize: 16, fontWeight: "900", color: "#E2E8F0" },
  emptySubDark: { marginTop: 6, textAlign: "center", color: "#94A3B8", fontWeight: "800", marginBottom: 10 },

  workoutCardDark: { backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 22, padding: 14, borderWidth: 1, borderColor: "rgba(148,163,184,0.16)", marginBottom: 12 },
  workoutHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 },
  workoutTitleCol: { flex: 1 },
  workoutTitleDark: { fontSize: 16, fontWeight: "900", color: "#E2E8F0" },
  previewText: { marginTop: 8, color: "rgba(226,232,240,0.85)", fontWeight: "700", fontSize: 12 },

  badge: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1 },
  badgeOn: { backgroundColor: "rgba(34,211,238,0.92)", borderColor: "rgba(34,211,238,0.92)" },
  badgeOff: { backgroundColor: "rgba(255,255,255,0.06)", borderColor: "rgba(148,163,184,0.18)" },
  badgeText: { fontWeight: "900", fontSize: 11 },
  badgeTextOn: { color: "#0B1220" },
  badgeTextOff: { color: "#E2E8F0" },

  quickRow: { flexDirection: "row", gap: 10, marginTop: 12, flexWrap: "wrap" },
  quickBtn: { flexGrow: 1, flexBasis: "30%", backgroundColor: "rgba(34,211,238,0.92)", borderRadius: 16, paddingVertical: 10, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8 },
  quickBtnPink: { flexGrow: 1, flexBasis: "30%", backgroundColor: "rgba(236,72,153,0.92)", borderRadius: 16, paddingVertical: 10, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8 },
  quickBtnGhost: { flexGrow: 1, flexBasis: "30%", backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 16, paddingVertical: 10, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8, borderWidth: 1, borderColor: "rgba(148,163,184,0.16)" },
  quickText: { fontWeight: "900", color: "#0B1220" },
  quickTextGhost: { fontWeight: "900", color: "#E2E8F0" },

  quickBtnDanger: { flexGrow: 1, flexBasis: "30%", backgroundColor: "#fee2e2", borderRadius: 16, paddingVertical: 10, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8 },
  quickTextDanger: { fontWeight: "900", color: "#991b1b" },

  editorHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  editorTitleDark: { fontSize: 16, fontWeight: "900", color: "#E2E8F0" },

  detailsCard: { backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 22, padding: 16, borderWidth: 1, borderColor: "rgba(148,163,184,0.16)" },
  detailsTitle: { fontSize: 20, fontWeight: "900", color: "#E2E8F0" },
  detailsMeta: { marginTop: 8, color: "#94A3B8", fontWeight: "800" },
  detailsPlanBox: { marginTop: 14, backgroundColor: "rgba(255,255,255,0.06)", borderRadius: 18, padding: 12, borderWidth: 1, borderColor: "rgba(148,163,184,0.14)" },
  detailsPlanTitle: { color: "#E2E8F0", fontWeight: "900", marginBottom: 8 },
  detailsPlanLine: { color: "rgba(226,232,240,0.88)", fontWeight: "700", marginBottom: 6 },
  detailsActionsRow: { flexDirection: "row", gap: 10, marginTop: 12, flexWrap: "wrap" },

  profileCardDark: { marginTop: 14, backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 22, padding: 16, borderWidth: 1, borderColor: "rgba(148,163,184,0.16)" },
  reloadBtn: { marginTop: 10, alignItems: "center", padding: 12, borderRadius: 16, backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: "rgba(148,163,184,0.14)" },
  reloadText: { color: "#E2E8F0", fontWeight: "900" },

  profileStatsRow: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 6, marginBottom: 10 },
  profileStat: { width: "47.5%", backgroundColor: "rgba(255,255,255,0.06)", borderRadius: 18, padding: 12, borderWidth: 1, borderColor: "rgba(148,163,184,0.14)" },
  profileStatLabel: { color: "#94A3B8", fontWeight: "900", fontSize: 12 },
  profileStatValue: { marginTop: 8, color: "#E2E8F0", fontWeight: "900", fontSize: 18 },

  achWrap: { marginTop: 14 },
  achHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  achTitle: { color: "#E2E8F0", fontWeight: "900", fontSize: 16 },
  achCount: { color: "#94A3B8", fontWeight: "900" },
  achSection: { marginTop: 10, color: "#94A3B8", fontWeight: "900", fontSize: 12 },
  achEmpty: { marginTop: 8, color: "rgba(226,232,240,0.78)", fontWeight: "700" },

  achItemOn: { flexDirection: "row", gap: 10, alignItems: "center", backgroundColor: "rgba(34,211,238,0.92)", padding: 12, borderRadius: 18, marginTop: 10 },
  achItemTitleOn: { color: "#0B1220", fontWeight: "900" },
  achItemDescOn: { color: "rgba(11,18,32,0.85)", fontWeight: "800", fontSize: 12, marginTop: 2 },

  achItemOff: { flexDirection: "row", gap: 10, alignItems: "center", backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: "rgba(148,163,184,0.14)", padding: 12, borderRadius: 18, marginTop: 10 },
  achItemTitleOff: { color: "#E2E8F0", fontWeight: "900" },
  achItemDescOff: { color: "#94A3B8", fontWeight: "800", fontSize: 12, marginTop: 2 },

  timerCard: { backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 22, padding: 16, borderWidth: 1, borderColor: "rgba(148,163,184,0.16)" },
  timerTitle: { color: "#E2E8F0", fontWeight: "900", textAlign: "center" },
  timerBig: { marginTop: 12, color: "#E2E8F0", fontWeight: "900", fontSize: 46, textAlign: "center" },

  timerPresetRow: { flexDirection: "row", gap: 10, marginTop: 14 },
  timerPreset: { flex: 1, height: 44, borderRadius: 16, backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: "rgba(148,163,184,0.14)", alignItems: "center", justifyContent: "center" },
  timerPresetText: { color: "#E2E8F0", fontWeight: "900" },

  timerControlsRow: { flexDirection: "row", gap: 10, marginTop: 14 },
  timerBtn: { flex: 1, height: 48, borderRadius: 16, backgroundColor: "rgba(34,211,238,0.92)", alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8 },
  timerBtnMain: { flex: 1.2, height: 48, borderRadius: 16, backgroundColor: "rgba(236,72,153,0.92)", alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8 },
  timerBtnText: { color: "#0B1220", fontWeight: "900" },

  timerReset: { marginTop: 12, alignItems: "center", padding: 10 },
  timerResetText: { color: "#94A3B8", fontWeight: "900" },

  logoutBtn: { marginTop: 12, alignItems: "center", padding: 10 },
  logoutText: { color: "#fb7185", fontWeight: "900" },
});
