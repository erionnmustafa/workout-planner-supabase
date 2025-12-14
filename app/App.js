import "react-native-gesture-handler";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
  Linking,
  ScrollView,
} from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { WebView } from "react-native-webview";
import * as Notifications from "expo-notifications";
import { supabase } from "./supabaseClient";

const Tab = createBottomTabNavigator();

const BUCKET_AVATARS = "avatars";
const BUCKET_WORKOUT_IMAGES = "workout-images";
const PH = "#111827";

function cacheBust(url) {
  if (!url) return null;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}t=${Date.now()}`;
}

function ytToEmbed(url) {
  if (!url) return null;
  const m =
    url.match(/youtu\.be\/([A-Za-z0-9_-]+)/) ||
    url.match(/v=([A-Za-z0-9_-]+)/) ||
    url.match(/embed\/([A-Za-z0-9_-]+)/);
  const id = m?.[1];
  if (!id) return null;
  return `https://www.youtube.com/embed/${id}?playsinline=1&autoplay=1&rel=0`;
}

async function pickImageSquare() {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    Alert.alert("Permission needed", "Allow photo access to upload images.");
    return null;
  }
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.9,
  });
  if (res.canceled) return null;
  return res.assets?.[0]?.uri || null;
}

async function uploadToBucket(bucket, uri, fileNameInsideUserFolder) {
  const r = await fetch(uri);
  const blob = await r.blob();

  const { data: authData } = await supabase.auth.getUser();
  const uid = authData?.user?.id;
  if (!uid) throw new Error("No authenticated user. Please login again.");

  const finalPath = `${uid}/${fileNameInsideUserFolder}`;

  const { error } = await supabase.storage.from(bucket).upload(finalPath, blob, {
    upsert: true,
    contentType: "image/jpeg",
  });
  if (error) throw error;

  const { data } = supabase.storage.from(bucket).getPublicUrl(finalPath);
  return { publicUrl: data.publicUrl, path: finalPath, uid };
}

function prettyAuthError(error) {
  const msg = (error?.message || "").toLowerCase();
  if (msg.includes("invalid login credentials")) return "Email or password is incorrect.";
  if (msg.includes("email not confirmed")) return "Confirm your email first (check inbox).";
  if (msg.includes("password should be at least")) return "Password is too short.";
  if (msg.includes("user already registered")) return "This email is already registered.";
  return error?.message || "Something went wrong.";
}

async function ensureNotificationPermissions() {
  const { status } = await Notifications.getPermissionsAsync();
  if (status === "granted") return true;
  const req = await Notifications.requestPermissionsAsync();
  return req.status === "granted";
}

async function scheduleDailyReminder(timeHHmm) {
  await Notifications.cancelAllScheduledNotificationsAsync();
  const ok = await ensureNotificationPermissions();
  if (!ok) return;

  const [hh, mm] = (timeHHmm || "19:00").split(":").map((x) => parseInt(x, 10));
  const hour = Number.isFinite(hh) ? hh : 19;
  const minute = Number.isFinite(mm) ? mm : 0;

  await Notifications.scheduleNotificationAsync({
    content: {
      title: "Workout Planner 💪",
      body: "Time to train. Keep the streak alive.",
      sound: true,
    },
    trigger: { hour, minute, repeats: true },
  });
}

function startOfWeek(d) {
  const x = new Date(d);
  const day = x.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  x.setDate(x.getDate() + diff);
  x.setHours(0, 0, 0, 0);
  return x;
}

function dayKey(d) {
  return new Date(d).toDateString();
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
        <Tab.Screen name="Dashboard">{(p) => <DashboardScreen {...p} session={session} />}</Tab.Screen>
        <Tab.Screen name="Workouts">{(p) => <WorkoutsScreen {...p} session={session} />}</Tab.Screen>
        <Tab.Screen name="Profile">{(p) => <ProfileScreen {...p} session={session} />}</Tab.Screen>
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
      Alert.alert("Login failed", "Email or password is incorrect.");
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
          <Text style={styles.subTitle}>Workouts • Photos • Video demos • Achievements</Text>

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
  const [avatar, setAvatar] = useState(null);
  const [fullName, setFullName] = useState("");
  const [totalWorkouts, setTotalWorkouts] = useState(0);

  const [completionsTotal, setCompletionsTotal] = useState(0);
  const [weeklyTarget, setWeeklyTarget] = useState(3);
  const [weeklyDone, setWeeklyDone] = useState(0);
  const [streak, setStreak] = useState(0);
  const [points, setPoints] = useState(0);

  const [goal, setGoal] = useState("General Fitness");
  const [level, setLevel] = useState("Beginner");
  const [remindersEnabled, setRemindersEnabled] = useState(false);
  const [reminderTime, setReminderTime] = useState("19:00");

  const [savingSettings, setSavingSettings] = useState(false);

  const achievements = useMemo(() => {
    const a = [];
    a.push({ key: "first_workout", title: "First Workout", desc: "Create your first plan.", ok: totalWorkouts >= 1 });
    a.push({ key: "five_workouts", title: "5 Workouts", desc: "Create 5 workout plans.", ok: totalWorkouts >= 5 });
    a.push({ key: "first_completion", title: "First Completion", desc: "Complete a workout once.", ok: completionsTotal >= 1 });
    a.push({ key: "ten_completions", title: "10 Completions", desc: "Complete 10 workouts.", ok: completionsTotal >= 10 });
    a.push({ key: "streak3", title: "Streak Starter", desc: "3-day streak.", ok: streak >= 3 });
    a.push({ key: "streak7", title: "Streak Master", desc: "7-day streak.", ok: streak >= 7 });
    a.push({ key: "points100", title: "Point Collector", desc: "Earn 100 points.", ok: points >= 100 });
    return a;
  }, [totalWorkouts, completionsTotal, streak, points]);

  const earnedCount = achievements.filter((x) => x.ok).length;

  const calcStreakFromCompletions = (rows) => {
    if (!rows?.length) return 0;
    const days = new Set(rows.map((r) => dayKey(r.completed_at)));
    let s = 0;
    let d = new Date();
    d.setHours(0, 0, 0, 0);
    while (days.has(d.toDateString())) {
      s += 1;
      d.setDate(d.getDate() - 1);
    }
    return s;
  };

  const load = async () => {
    setLoading(true);

    const { data: prof } = await supabase
      .from("profiles")
      .select("full_name, avatar_url")
      .eq("user_id", user.id)
      .maybeSingle();

    setAvatar(prof?.avatar_url || null);
    setFullName(prof?.full_name || "");

    const { data: setg } = await supabase
      .from("user_settings")
      .select("goal, level, weekly_target, reminders_enabled, reminder_time, points")
      .eq("user_id", user.id)
      .maybeSingle();

    const g = setg?.goal || "General Fitness";
    const l = setg?.level || "Beginner";
    const wt = Number.isFinite(setg?.weekly_target) ? setg.weekly_target : 3;
    const re = !!setg?.reminders_enabled;
    const rt = setg?.reminder_time || "19:00";
    const pts = Number.isFinite(setg?.points) ? setg.points : 0;

    setGoal(g);
    setLevel(l);
    setWeeklyTarget(wt);
    setRemindersEnabled(re);
    setReminderTime(rt);
    setPoints(pts);

    const { data: w } = await supabase
      .from("workouts")
      .select("id")
      .eq("user_id", user.id);

    setTotalWorkouts((w || []).length);

    const { data: c } = await supabase
      .from("workout_completions")
      .select("id, completed_at")
      .eq("user_id", user.id)
      .order("completed_at", { ascending: false });

    const comps = c || [];
    setCompletionsTotal(comps.length);

    const sow = startOfWeek(new Date());
    const weekly = comps.filter((x) => new Date(x.completed_at) >= sow).length;
    setWeeklyDone(weekly);

    setStreak(calcStreakFromCompletions(comps));

    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const saveSettings = async () => {
    const wt = parseInt(String(weeklyTarget), 10);
    const safeWT = Number.isFinite(wt) && wt > 0 ? wt : 3;

    const rt = (reminderTime || "19:00").trim();
    const okTime = /^\d{2}:\d{2}$/.test(rt);
    const safeTime = okTime ? rt : "19:00";

    setSavingSettings(true);

    const payload = {
      user_id: user.id,
      goal: goal || "General Fitness",
      level: level || "Beginner",
      weekly_target: safeWT,
      reminders_enabled: !!remindersEnabled,
      reminder_time: safeTime,
      points: Number.isFinite(points) ? points : 0,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase.from("user_settings").upsert(payload);

    if (error) {
      Alert.alert("Save failed", error.message);
      setSavingSettings(false);
      return;
    }

    if (payload.reminders_enabled) await scheduleDailyReminder(payload.reminder_time);
    else await Notifications.cancelAllScheduledNotificationsAsync();

    await load();
    setSavingSettings(false);
    Alert.alert("Saved", "Dashboard settings updated.");
  };

  return (
    <SafeAreaView style={styles.screen}>
      <LinearGradient colors={["#050816", "#0B1220", "#070A12"]} style={styles.bg} />
      <ScrollView contentContainerStyle={{ paddingBottom: 110 }}>
        <View style={styles.page}>
          <View style={styles.topRow}>
            <View style={styles.profileMini}>
              <View style={styles.avatarMini}>
                {avatar ? (
                  <Image source={{ uri: cacheBust(avatar) }} style={styles.avatarImg} />
                ) : (
                  <Ionicons name="person" size={16} color="#E2E8F0" />
                )}
              </View>
              <View>
                <Text style={styles.hiDark}>Welcome{fullName ? `, ${fullName}` : ""}</Text>
                <Text style={styles.smallDark} numberOfLines={1}>{user.email}</Text>
              </View>
            </View>

            <Pressable style={styles.iconBtnDark} onPress={load}>
              <Ionicons name="refresh-outline" size={18} color="#E2E8F0" />
            </Pressable>
          </View>

          <View style={styles.heroPanelDark}>
            <Text style={styles.heroTitleDark}>Dashboard</Text>
            <Text style={styles.heroQuoteDark}>Plan. Execute. Repeat.</Text>

            <View style={styles.heroActions}>
              <Pressable style={styles.neonChip} onPress={() => navigation.navigate("Workouts")}>
                <Ionicons name="barbell-outline" size={18} color="#0B1220" />
                <Text style={styles.neonChipText}>Open workouts</Text>
              </Pressable>
              <Pressable style={styles.neonChip} onPress={() => navigation.navigate("Profile")}>
                <Ionicons name="person-outline" size={18} color="#0B1220" />
                <Text style={styles.neonChipText}>Edit profile</Text>
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
                <Text style={styles.statLabelDark}>Completions</Text>
                <Ionicons name="checkmark-circle-outline" size={18} color="#E2E8F0" />
              </View>
              <Text style={styles.statValueDark}>{loading ? "..." : String(completionsTotal)}</Text>
              <Text style={styles.tapHint}>All time</Text>
            </View>

            <View style={styles.statBoxDark}>
              <View style={styles.statTop}>
                <Text style={styles.statLabelDark}>Weekly</Text>
                <Ionicons name="calendar-outline" size={18} color="#E2E8F0" />
              </View>
              <Text style={styles.statValueDark}>{loading ? "..." : `${weeklyDone}/${weeklyTarget}`}</Text>
              <Text style={styles.tapHint}>This week</Text>
            </View>

            <View style={styles.statBoxDark}>
              <View style={styles.statTop}>
                <Text style={styles.statLabelDark}>Streak</Text>
                <Ionicons name="flame-outline" size={18} color="#E2E8F0" />
              </View>
              <Text style={styles.statValueDark}>{loading ? "..." : `${streak}d`}</Text>
              <Text style={styles.tapHint}>Based on completions</Text>
            </View>

            <View style={styles.statBoxDark}>
              <View style={styles.statTop}>
                <Text style={styles.statLabelDark}>Points</Text>
                <Ionicons name="trophy-outline" size={18} color="#E2E8F0" />
              </View>
              <Text style={styles.statValueDark}>{loading ? "..." : String(points)}</Text>
              <Text style={styles.tapHint}>Rewards</Text>
            </View>

            <View style={styles.statBoxDark}>
              <View style={styles.statTop}>
                <Text style={styles.statLabelDark}>Achievements</Text>
                <Ionicons name="sparkles-outline" size={18} color="#E2E8F0" />
              </View>
              <Text style={styles.statValueDark}>{loading ? "..." : `${earnedCount}/${achievements.length}`}</Text>
              <Text style={styles.tapHint}>Unlocked</Text>
            </View>
          </View>

          <View style={styles.sectionCardDark}>
            <Text style={styles.sectionTitle}>Settings</Text>

            <TextInput
              value={goal}
              onChangeText={setGoal}
              placeholder="Goal (e.g. Bulk / Cut / Strength)"
              placeholderTextColor={PH}
              style={styles.inputDark}
            />
            <TextInput
              value={level}
              onChangeText={setLevel}
              placeholder="Level (Beginner / Intermediate / Advanced)"
              placeholderTextColor={PH}
              style={styles.inputDark}
            />
            <TextInput
              value={String(weeklyTarget)}
              onChangeText={(t) => setWeeklyTarget(t.replace(/[^\d]/g, ""))}
              placeholder="Weekly target (number)"
              placeholderTextColor={PH}
              keyboardType="numeric"
              style={styles.inputDark}
            />

            <View style={styles.rowBetween}>
              <View style={{ flex: 1 }}>
                <Text style={styles.smallDark}>Daily reminders</Text>
                <Text style={styles.miniHelp}>Schedules a local notification</Text>
              </View>
              <Pressable
                style={[styles.togglePill, remindersEnabled ? styles.toggleOn : styles.toggleOff]}
                onPress={() => setRemindersEnabled((x) => !x)}
              >
                <Text style={styles.toggleText}>{remindersEnabled ? "ON" : "OFF"}</Text>
              </Pressable>
            </View>

            <TextInput
              value={reminderTime}
              onChangeText={setReminderTime}
              placeholder="Reminder time HH:MM (e.g. 19:00)"
              placeholderTextColor={PH}
              style={styles.inputDark}
            />

            <Pressable style={[styles.primaryBtn, savingSettings && { opacity: 0.7 }]} onPress={saveSettings} disabled={savingSettings}>
              <Text style={styles.primaryBtnText}>{savingSettings ? "Saving..." : "Save settings"}</Text>
              <Ionicons name="save-outline" size={16} color="#0B1220" />
            </Pressable>
          </View>

          <View style={styles.sectionCardDark}>
            <View style={styles.rowBetween}>
              <Text style={styles.sectionTitle}>Achievements</Text>
              <Text style={styles.smallDark}>{earnedCount}/{achievements.length}</Text>
            </View>

            {achievements.map((a) => (
              <View key={a.key} style={[styles.achRow, a.ok ? styles.achOn : styles.achOff]}>
                <Ionicons name={a.ok ? "trophy" : "lock-closed"} size={18} color={a.ok ? "#0B1220" : "#E2E8F0"} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.achTitle, a.ok ? { color: "#0B1220" } : { color: "#E2E8F0" }]}>{a.title}</Text>
                  <Text style={[styles.achDesc, a.ok ? { color: "#0B1220" } : { color: "#94A3B8" }]}>{a.desc}</Text>
                </View>
              </View>
            ))}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function WorkoutsScreen({ session }) {
  const user = session.user;

  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const [name, setName] = useState("");
  const [planText, setPlanText] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [uploading, setUploading] = useState(false);

  const [playerOpen, setPlayerOpen] = useState(false);
  const [playerUrl, setPlayerUrl] = useState(null);

  const plan = useMemo(() => planText.split("\n").map((l) => l.trim()).filter(Boolean), [planText]);

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

  const openCreate = () => {
    setEditing(null);
    setName("");
    setPlanText("");
    setVideoUrl("");
    setImageUrl("");
    setEditorOpen(true);
  };

  const openEdit = (w) => {
    setEditing(w);
    setName(w.name || "");
    setPlanText((w.plan || []).join("\n"));
    setVideoUrl(w.video_url || "");
    setImageUrl(w.image_url || "");
    setEditorOpen(true);
  };

  const uploadWorkoutPhoto = async () => {
    const uri = await pickImageSquare();
    if (!uri) return;

    try {
      setUploading(true);
      const { publicUrl } = await uploadToBucket(BUCKET_WORKOUT_IMAGES, uri, `${Date.now()}.jpg`);
      setImageUrl(publicUrl);
    } catch (e) {
      Alert.alert("Upload failed", e?.message || String(e));
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    if (!name.trim()) return Alert.alert("Missing", "Enter a workout name.");
    if (plan.length === 0) return Alert.alert("Missing", "Add at least 1 plan line.");

    const payload = {
      name: name.trim(),
      plan,
      video_url: videoUrl.trim() || null,
      image_url: imageUrl || null,
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
    load();
  };

  const del = (id) => {
    Alert.alert("Delete workout?", "This can’t be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          const { error } = await supabase.from("workouts").delete().eq("id", id);
          if (error) Alert.alert("Delete failed", error.message);
          load();
        },
      },
    ]);
  };

  const play = (url) => {
    const embed = ytToEmbed(url);
    if (!embed) return Alert.alert("Invalid link", "Paste a valid YouTube URL.");
    setPlayerUrl(embed);
    setPlayerOpen(true);
  };

  const awardPoints = async (add) => {
    const { data: setg } = await supabase
      .from("user_settings")
      .select("points")
      .eq("user_id", user.id)
      .maybeSingle();

    const current = Number.isFinite(setg?.points) ? setg.points : 0;
    const next = current + add;

    await supabase.from("user_settings").upsert({
      user_id: user.id,
      points: next,
      updated_at: new Date().toISOString(),
    });
  };

  const complete = async (workoutId) => {
    const { error } = await supabase.from("workout_completions").insert({
      user_id: user.id,
      workout_id: workoutId,
      completed_at: new Date().toISOString(),
    });

    if (error) return Alert.alert("Complete failed", error.message);

    await awardPoints(10);
    Alert.alert("Completed ✅", "+10 points");
  };

  return (
    <SafeAreaView style={styles.screen}>
      <LinearGradient colors={["#050816", "#0B1220", "#070A12"]} style={styles.bg} />
      <View style={styles.page}>
        <View style={styles.topRow}>
          <View>
            <Text style={styles.hiDark}>Workouts</Text>
            <Text style={styles.smallDark}>History • Photos • Video demos • Completions</Text>
          </View>
          <Pressable style={styles.fabDark} onPress={openCreate}>
            <Ionicons name="add" size={22} color="#0B1220" />
          </Pressable>
        </View>

        {loading ? (
          <View style={styles.centerGrow}><ActivityIndicator /></View>
        ) : (
          <FlatList
            data={items}
            keyExtractor={(x) => String(x.id)}
            contentContainerStyle={{ paddingBottom: 110 }}
            ListEmptyComponent={
              <View style={styles.emptyCardDark}>
                <Ionicons name="barbell-outline" size={28} color="#E2E8F0" />
                <Text style={styles.emptyTitleDark}>No workouts yet</Text>
                <Text style={styles.emptySubDark}>Create one and attach photo + demo video.</Text>
                <Pressable style={styles.primaryBtn} onPress={openCreate}>
                  <Text style={styles.primaryBtnText}>Create workout</Text>
                </Pressable>
              </View>
            }
            renderItem={({ item }) => (
              <View style={styles.workoutCardDark}>
                <View style={styles.workoutTitleRow}>
                  {item.image_url ? (
                    <Image source={{ uri: cacheBust(item.image_url) }} style={styles.thumb} />
                  ) : (
                    <View style={styles.thumbFallbackDark}>
                      <Ionicons name="image-outline" size={16} color="#E2E8F0" />
                    </View>
                  )}

                  <View style={{ flex: 1 }}>
                    <Text style={styles.workoutTitleDark} numberOfLines={1}>{item.name}</Text>
                    <Text style={styles.smallDark} numberOfLines={2}>{(item.plan || []).join(" • ")}</Text>

                    <View style={styles.actionsRow}>
                      <Pressable
                        style={[styles.actionBtnDark, !item.video_url && { opacity: 0.5 }]}
                        onPress={() => item.video_url && play(item.video_url)}
                        disabled={!item.video_url}
                      >
                        <Ionicons name="play-circle-outline" size={18} color="#0B1220" />
                        <Text style={styles.actionTextDark}>{item.video_url ? "Play" : "No video"}</Text>
                      </Pressable>

                      <Pressable style={styles.actionBtnDark} onPress={() => complete(item.id)}>
                        <Ionicons name="checkmark-circle-outline" size={18} color="#0B1220" />
                        <Text style={styles.actionTextDark}>Complete</Text>
                      </Pressable>

                      <Pressable style={styles.actionBtnDark} onPress={() => openEdit(item)}>
                        <Ionicons name="create-outline" size={18} color="#0B1220" />
                        <Text style={styles.actionTextDark}>Edit</Text>
                      </Pressable>

                      <Pressable style={[styles.actionBtnDark, styles.dangerBtn]} onPress={() => del(item.id)}>
                        <Ionicons name="trash-outline" size={18} color="#991b1b" />
                        <Text style={[styles.actionTextDark, { color: "#991b1b" }]}>Delete</Text>
                      </Pressable>
                    </View>
                  </View>
                </View>
              </View>
            )}
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
              <TextInput value={name} onChangeText={setName} placeholder="Workout name" placeholderTextColor={PH} style={styles.inputDark} />
              <TextInput
                value={planText}
                onChangeText={setPlanText}
                placeholder={"Plan (one per line)\nBench Press 3x8\nIncline DB Press 3x10"}
                placeholderTextColor={PH}
                multiline
                style={[styles.inputDark, { height: 140, textAlignVertical: "top" }]}
              />
              <TextInput value={videoUrl} onChangeText={setVideoUrl} placeholder="YouTube URL (optional)" placeholderTextColor={PH} autoCapitalize="none" style={styles.inputDark} />

              <View style={styles.imageRow}>
                <View style={styles.imageBoxDark}>
                  {imageUrl ? (
                    <Image source={{ uri: cacheBust(imageUrl) }} style={styles.imagePreview} />
                  ) : (
                    <View style={styles.imageEmpty}>
                      <Ionicons name="image-outline" size={18} color="#E2E8F0" />
                      <Text style={styles.imageEmptyTextDark}>No photo</Text>
                    </View>
                  )}
                </View>

                <Pressable style={styles.neonBtn} onPress={uploadWorkoutPhoto} disabled={uploading}>
                  <Ionicons name="cloud-upload-outline" size={18} color="#0B1220" />
                  <Text style={styles.neonBtnText}>{uploading ? "Uploading..." : "Upload photo"}</Text>
                </Pressable>
              </View>

              <Pressable style={styles.primaryBtn} onPress={save}>
                <Text style={styles.primaryBtnText}>{editing ? "Save changes" : "Create workout"}</Text>
              </Pressable>
            </View>
          </View>
        </SafeAreaView>
      </Modal>

      <Modal visible={playerOpen} animationType="slide">
        <SafeAreaView style={styles.playerScreen}>
          <View style={styles.playerHeader}>
            <Pressable style={styles.iconBtnDark} onPress={() => setPlayerOpen(false)}>
              <Ionicons name="close" size={18} color="#E2E8F0" />
            </Pressable>
            <Text style={styles.playerTitleDark}>Video Demo</Text>
            <View style={{ width: 44 }} />
          </View>

          {playerUrl ? (
            <WebView source={{ uri: playerUrl }} style={{ flex: 1 }} javaScriptEnabled domStorageEnabled originWhitelist={["*"]} allowsFullscreenVideo />
          ) : (
            <View style={styles.center}><Text>No video</Text></View>
          )}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

function ProfileScreen({ session }) {
  const user = session.user;
  const [loading, setLoading] = useState(true);
  const [fullName, setFullName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("profiles")
      .select("full_name, avatar_url")
      .eq("user_id", user.id)
      .maybeSingle();

    setFullName(data?.full_name || "");
    setAvatarUrl(data?.avatar_url || null);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const uploadAvatar = async () => {
    const uri = await pickImageSquare();
    if (!uri) return;

    try {
      setUploading(true);

      const { publicUrl } = await uploadToBucket(BUCKET_AVATARS, uri, "avatar.jpg");

      const { error } = await supabase.from("profiles").upsert({
        user_id: user.id,
        full_name: fullName || null,
        avatar_url: publicUrl,
        updated_at: new Date().toISOString(),
      });

      if (error) Alert.alert("Save failed", error.message);
      else {
        await load();
        Alert.alert("Saved", "Profile photo saved.");
      }
    } catch (e) {
      Alert.alert("Upload failed", e?.message || String(e));
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    setSaving(true);
    const { error } = await supabase.from("profiles").upsert({
      user_id: user.id,
      full_name: fullName || null,
      avatar_url: avatarUrl || null,
      updated_at: new Date().toISOString(),
    });
    setSaving(false);
    if (error) Alert.alert("Save failed", error.message);
    else {
      await load();
      Alert.alert("Saved", "Profile updated.");
    }
  };

  const openAvatar = async () => {
    if (!avatarUrl) return Alert.alert("No photo", "Upload a profile photo first.");
    Linking.openURL(avatarUrl);
  };

  const logout = async () => {
    await supabase.auth.signOut();
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.center}><ActivityIndicator /></SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <LinearGradient colors={["#050816", "#0B1220", "#070A12"]} style={styles.bg} />
      <View style={styles.page}>
        <Text style={styles.hiDark}>Profile</Text>
        <Text style={styles.smallDark} numberOfLines={1}>{user.email}</Text>

        <View style={styles.profileCardDark}>
          <View style={styles.avatarBig}>
            {avatarUrl ? (
              <Image source={{ uri: cacheBust(avatarUrl) }} style={styles.avatarBigImg} />
            ) : (
              <Ionicons name="person" size={28} color="#E2E8F0" />
            )}
          </View>

          <Pressable style={styles.neonBtn} onPress={uploadAvatar} disabled={uploading}>
            <Ionicons name="image-outline" size={18} color="#0B1220" />
            <Text style={styles.neonBtnText}>{uploading ? "Uploading..." : "Upload profile photo"}</Text>
          </Pressable>

          <Pressable style={styles.toolBtnWide} onPress={openAvatar} disabled={!avatarUrl}>
            <Ionicons name="open-outline" size={18} color="#0B1220" />
            <Text style={styles.toolText}>Open photo</Text>
          </Pressable>

          <TextInput value={fullName} onChangeText={setFullName} placeholder="Full name" placeholderTextColor={PH} style={styles.inputDark} />

          <Pressable style={[styles.primaryBtn, saving && { opacity: 0.7 }]} onPress={save} disabled={saving}>
            <Text style={styles.primaryBtnText}>{saving ? "Saving..." : "Save profile"}</Text>
            <Ionicons name="save-outline" size={16} color="#0B1220" />
          </Pressable>

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
  profileMini: { flexDirection: "row", alignItems: "center", gap: 10 },
  avatarMini: { width: 36, height: 36, borderRadius: 14, backgroundColor: "rgba(255,255,255,0.10)", alignItems: "center", justifyContent: "center", overflow: "hidden", borderWidth: 1, borderColor: "rgba(148,163,184,0.18)" },
  avatarImg: { width: "100%", height: "100%" },

  hiDark: { fontSize: 18, fontWeight: "900", color: "#E2E8F0" },
  smallDark: { fontSize: 12, color: "#94A3B8", marginTop: 2, maxWidth: 260 },

  iconBtnDark: { width: 44, height: 44, borderRadius: 16, backgroundColor: "rgba(255,255,255,0.08)", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(148,163,184,0.16)" },

  heroPanelDark: { backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 22, padding: 16, borderWidth: 1, borderColor: "rgba(148,163,184,0.16)", marginBottom: 14 },
  heroTitleDark: { fontSize: 13, fontWeight: "900", color: "#94A3B8" },
  heroQuoteDark: { marginTop: 8, fontSize: 18, fontWeight: "900", color: "#E2E8F0" },
  heroActions: { flexDirection: "row", gap: 10, marginTop: 12 },

  neonChip: { flex: 1, backgroundColor: "rgba(34,211,238,0.92)", paddingVertical: 10, borderRadius: 16, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8 },
  neonChipText: { fontWeight: "900", color: "#0B1220" },

  statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  statBoxDark: { width: "47.5%", backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 20, padding: 14, borderWidth: 1, borderColor: "rgba(148,163,184,0.16)" },
  statTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  statLabelDark: { fontSize: 12, color: "#94A3B8", fontWeight: "900" },
  statValueDark: { marginTop: 10, fontSize: 18, fontWeight: "900", color: "#E2E8F0" },
  tapHint: { marginTop: 8, fontSize: 11, color: "rgba(226,232,240,0.6)", fontWeight: "800" },

  fabDark: { width: 46, height: 46, borderRadius: 16, backgroundColor: "rgba(34,211,238,0.92)", alignItems: "center", justifyContent: "center" },

  emptyCardDark: { marginTop: 30, backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 22, padding: 18, borderWidth: 1, borderColor: "rgba(148,163,184,0.16)", alignItems: "center" },
  emptyTitleDark: { marginTop: 10, fontSize: 16, fontWeight: "900", color: "#E2E8F0" },
  emptySubDark: { marginTop: 6, textAlign: "center", color: "#94A3B8", fontWeight: "800", marginBottom: 10 },

  workoutCardDark: { backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 22, padding: 14, borderWidth: 1, borderColor: "rgba(148,163,184,0.16)", marginBottom: 12 },
  workoutTitleRow: { flexDirection: "row", gap: 10, alignItems: "center" },
  thumb: { width: 44, height: 44, borderRadius: 16 },
  thumbFallbackDark: { width: 44, height: 44, borderRadius: 16, backgroundColor: "rgba(255,255,255,0.08)", borderWidth: 1, borderColor: "rgba(148,163,184,0.16)", alignItems: "center", justifyContent: "center" },
  workoutTitleDark: { fontSize: 16, fontWeight: "900", color: "#E2E8F0" },

  actionsRow: { flexDirection: "row", gap: 10, marginTop: 10, flexWrap: "wrap" },
  actionBtnDark: { flexGrow: 1, flexBasis: "45%", backgroundColor: "rgba(34,211,238,0.92)", borderRadius: 16, paddingVertical: 10, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8 },
  actionTextDark: { fontWeight: "900", color: "#0B1220" },
  dangerBtn: { backgroundColor: "#fee2e2" },

  editorHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  editorTitleDark: { fontSize: 16, fontWeight: "900", color: "#E2E8F0" },

  imageRow: { flexDirection: "row", gap: 10, alignItems: "center", marginBottom: 10 },
  imageBoxDark: { width: 96, height: 96, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.08)", borderWidth: 1, borderColor: "rgba(148,163,184,0.16)", overflow: "hidden", alignItems: "center", justifyContent: "center" },
  imagePreview: { width: "100%", height: "100%" },
  imageEmpty: { alignItems: "center" },
  imageEmptyTextDark: { marginTop: 6, fontWeight: "900", color: "#E2E8F0", fontSize: 12 },

  neonBtn: { flex: 1, height: 48, borderRadius: 16, backgroundColor: "rgba(236,72,153,0.92)", alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8, paddingHorizontal: 12 },
  neonBtnText: { fontWeight: "900", color: "#0B1220" },

  playerScreen: { flex: 1, backgroundColor: "#050816" },
  playerHeader: { height: 56, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: "rgba(148,163,184,0.16)", flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  playerTitleDark: { fontWeight: "900", color: "#E2E8F0" },

  profileCardDark: { marginTop: 14, backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 22, padding: 16, borderWidth: 1, borderColor: "rgba(148,163,184,0.16)" },
  avatarBig: { width: 110, height: 110, borderRadius: 30, backgroundColor: "rgba(255,255,255,0.08)", borderWidth: 1, borderColor: "rgba(148,163,184,0.16)", alignItems: "center", justifyContent: "center", overflow: "hidden", alignSelf: "center", marginBottom: 12 },
  avatarBigImg: { width: "100%", height: "100%" },

  logoutBtn: { marginTop: 10, alignItems: "center", padding: 10 },
  logoutText: { color: "#fb7185", fontWeight: "900" },

  sectionCardDark: { marginTop: 14, backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 22, padding: 16, borderWidth: 1, borderColor: "rgba(148,163,184,0.16)" },
  sectionTitle: { fontSize: 16, fontWeight: "900", color: "#E2E8F0", marginBottom: 10 },

  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 10 },
  miniHelp: { fontSize: 11, color: "rgba(226,232,240,0.6)", fontWeight: "800", marginTop: 4 },

  togglePill: { width: 72, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  toggleOn: { backgroundColor: "rgba(34,211,238,0.92)" },
  toggleOff: { backgroundColor: "rgba(255,255,255,0.10)", borderWidth: 1, borderColor: "rgba(148,163,184,0.18)" },
  toggleText: { fontWeight: "900", color: "#0B1220" },

  achRow: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 18, padding: 12, marginBottom: 10 },
  achOn: { backgroundColor: "rgba(34,211,238,0.92)" },
  achOff: { backgroundColor: "rgba(255,255,255,0.08)", borderWidth: 1, borderColor: "rgba(148,163,184,0.16)" },
  achTitle: { fontWeight: "900" },
  achDesc: { marginTop: 2, fontWeight: "800", fontSize: 12 },

  toolBtnWide: { marginBottom: 10, height: 44, borderRadius: 16, backgroundColor: "rgba(34,211,238,0.92)", alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8 },
  toolText: { fontWeight: "900", color: "#0B1220" },
});
