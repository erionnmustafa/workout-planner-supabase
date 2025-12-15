// App.js (FULL UPDATED - copy/paste)
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
  StyleSheet,
  Text,
  TextInput,
  View,
  ScrollView,
  Animated,
  Easing,
  Dimensions,
} from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { WebView } from "react-native-webview";
import * as Notifications from "expo-notifications";
import { Video } from "expo-av";
import * as Linking from "expo-linking";
import { supabase } from "./supabaseClient";

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

const BUCKET_AVATARS = "avatars";
const BUCKET_WORKOUT_IMAGES = "workout-images";
const BUCKET_WORKOUT_VIDEOS = "workout-videos";
const PH = "#111827";

const { width: W } = Dimensions.get("window");

function cacheBust(url) {
  if (!url) return null;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}t=${Date.now()}`;
}

function isYouTubeUrl(url) {
  const u = (url || "").toLowerCase();
  return u.includes("youtube.com") || u.includes("youtu.be") || u.includes("youtube-nocookie.com");
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
  return res.assets?.[0] || null;
}

async function pickVideo() {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    Alert.alert("Permission needed", "Allow video access to upload videos.");
    return null;
  }
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Videos,
    quality: 1,
    allowsEditing: false,
  });
  if (res.canceled) return null;
  return res.assets?.[0] || null;
}

async function uploadToBucket(bucket, uri, fileNameInsideUserFolder, contentTypeOverride) {
  const response = await fetch(uri);
  const blob = await response.blob();

  const { data: authData } = await supabase.auth.getUser();
  const uid = authData?.user?.id;
  if (!uid) throw new Error("No authenticated user. Please login again.");

  const finalPath = `${uid}/${fileNameInsideUserFolder}`;
  const contentType = contentTypeOverride || blob.type || "application/octet-stream";

  const { error } = await supabase.storage.from(bucket).upload(finalPath, blob, {
    upsert: true,
    contentType,
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

function dateToYMD(d) {
  const x = new Date(d);
  const yyyy = x.getFullYear();
  const mm = String(x.getMonth() + 1).padStart(2, "0");
  const dd = String(x.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function ymdToBounds(ymd) {
  const [y, m, d] = (ymd || "").split("-").map((x) => parseInt(x, 10));
  const s = new Date(y, (m || 1) - 1, d || 1, 0, 0, 0, 0);
  const e = new Date(s);
  e.setDate(e.getDate() + 1);
  return { startISO: s.toISOString(), endISO: e.toISOString(), startLocal: s, endLocal: e };
}

/** =======================
 *  NEW: more “alive” decor
 *  ======================= */
function NewYearDecor() {
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(
      Animated.timing(a, {
        toValue: 1,
        duration: 4200,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      })
    ).start();
  }, []);

  const t1 = a.interpolate({ inputRange: [0, 1], outputRange: [0, 10] });
  const t2 = a.interpolate({ inputRange: [0, 1], outputRange: [0, -12] });
  const s1 = a.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] });

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>
      <Animated.View style={[styles.nyOrb1, { transform: [{ translateY: t1 }, { scale: s1 }] }]} />
      <Animated.View style={[styles.nyOrb2, { transform: [{ translateY: t2 }, { scale: s1 }] }]} />
      <Animated.View style={[styles.nyOrb3, { transform: [{ translateY: t1 }] }]} />
      <View style={styles.nySparkRow}>
        <Ionicons name="sparkles" size={18} color="rgba(236,72,153,0.55)" />
        <Ionicons name="snow" size={18} color="rgba(34,211,238,0.55)" />
        <Ionicons name="sparkles" size={18} color="rgba(34,211,238,0.35)" />
      </View>
    </View>
  );
}

/** =======================
 *  NEW: UI helpers
 *  ======================= */
function xpFromPoints(points) {
  const p = Number.isFinite(points) ? points : 0;
  const level = Math.floor(p / 100) + 1;
  const inLevel = p % 100;
  const pct = Math.max(0, Math.min(1, inLevel / 100));
  return { level, inLevel, pct, nextAt: level * 100 };
}

function ProgressBar({ pct }) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(anim, {
      toValue: Math.max(0, Math.min(1, pct || 0)),
      duration: 650,
      useNativeDriver: false,
    }).start();
  }, [pct]);

  const w = anim.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] });

  return (
    <View style={styles.pbOuter}>
      <Animated.View style={[styles.pbInner, { width: w }]} />
    </View>
  );
}

function Chip({ icon, label, onPress, subtle }) {
  return (
    <Pressable style={[styles.chip, subtle && styles.chipSubtle]} onPress={onPress}>
      {icon ? <Ionicons name={icon} size={16} color={subtle ? "#E2E8F0" : "#0B1220"} /> : null}
      <Text style={[styles.chipText, subtle && { color: "#E2E8F0" }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

/** =======================
 *  Verify email screen
 *  ======================= */
function VerifyEmailScreen({ email }) {
  const [busy, setBusy] = useState(false);

  const resend = async () => {
    try {
      setBusy(true);
      const { error } = await supabase.auth.resend({ type: "signup", email });
      if (error) Alert.alert("Resend failed", error.message);
      else Alert.alert("Sent", "Verification email sent. Check inbox/spam.");
    } catch (e) {
      Alert.alert("Resend failed", e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const refresh = async () => {
    try {
      const { data, error } = await supabase.auth.getUser();
      if (error) return Alert.alert("Refresh failed", error.message);
      const confirmed = !!(data?.user?.email_confirmed_at || data?.user?.confirmed_at);
      if (!confirmed) Alert.alert("Not verified yet", "Verify your email, then tap Refresh again.");
      else Alert.alert("Verified ✅", "You can continue now.");
    } catch (e) {
      Alert.alert("Refresh failed", e?.message || String(e));
    }
  };

  const logout = async () => {
    await supabase.auth.signOut();
  };

  return (
    <View style={styles.screen}>
      <LinearGradient colors={["#050816", "#0B1220", "#070A12"]} style={styles.bg} />
      <NewYearDecor />
      <View style={[styles.page, { justifyContent: "center" }]}>
        <View style={styles.glassCardDark}>
          <View style={{ alignItems: "center", marginBottom: 10 }}>
            <View style={styles.brandIcon}>
              <Ionicons name="mail-unread" size={18} color="#0B1220" />
            </View>
            <Text style={[styles.bigTitle, { fontSize: 22, marginTop: 10 }]}>Verify your email</Text>
            <Text style={[styles.subTitle, { marginBottom: 0 }]}>
              We sent a verification link to{"\n"}
              <Text style={{ color: "#E2E8F0", fontWeight: "900" }}>{email}</Text>
            </Text>
          </View>

          <Pressable style={[styles.primaryBtn, busy && { opacity: 0.7 }]} onPress={resend} disabled={busy}>
            <Text style={styles.primaryBtnText}>{busy ? "Sending..." : "Resend verification email"}</Text>
            <Ionicons name="send-outline" size={16} color="#0B1220" />
          </Pressable>

          <Pressable style={styles.toolBtnWide} onPress={refresh}>
            <Ionicons name="refresh-outline" size={18} color="#0B1220" />
            <Text style={styles.toolText}>Refresh</Text>
          </Pressable>

          <Pressable style={styles.logoutBtn} onPress={logout}>
            <Text style={styles.logoutText}>Logout</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function parseRecoveryFromUrl(url) {
  if (!url) return null;

  const hashIndex = url.indexOf("#");
  const queryIndex = url.indexOf("?");

  const fragment = hashIndex >= 0 ? url.slice(hashIndex + 1) : "";
  const query = queryIndex >= 0 ? url.slice(queryIndex + 1, hashIndex >= 0 ? hashIndex : undefined) : "";

  const hashParams = new URLSearchParams(fragment);
  const queryParams = new URLSearchParams(query);

  const access_token = hashParams.get("access_token") || queryParams.get("access_token");
  const refresh_token = hashParams.get("refresh_token") || queryParams.get("refresh_token");
  const type = hashParams.get("type") || queryParams.get("type");

  if (!access_token || type !== "recovery") return null;
  return { access_token, refresh_token };
}

/** =======================
 *  App
 *  ======================= */
export default function App() {
  const [session, setSession] = useState(null);
  const [loadingSession, setLoadingSession] = useState(true);

  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [newPass, setNewPass] = useState("");
  const [newPass2, setNewPass2] = useState("");
  const [recoveryBusy, setRecoveryBusy] = useState(false);

  const handleUrl = async (url) => {
    const rec = parseRecoveryFromUrl(url);
    if (!rec) return;

    try {
      await supabase.auth.setSession({
        access_token: rec.access_token,
        refresh_token: rec.refresh_token || "",
      });
      setRecoveryOpen(true);
    } catch (e) {
      Alert.alert("Reset failed", e?.message || String(e));
    }
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoadingSession(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));

    (async () => {
      const initial = await Linking.getInitialURL();
      if (initial) await handleUrl(initial);
    })();

    const listener = Linking.addEventListener("url", ({ url }) => {
      handleUrl(url);
    });

    return () => {
      sub.subscription.unsubscribe();
      listener.remove();
    };
  }, []);

  const confirmReset = async () => {
    const p1 = (newPass || "").trim();
    const p2 = (newPass2 || "").trim();
    if (!p1 || !p2) return Alert.alert("Missing", "Enter the new password twice.");
    if (p1.length < 6) return Alert.alert("Too short", "Password must be at least 6 characters.");
    if (p1 !== p2) return Alert.alert("Mismatch", "Passwords do not match.");

    try {
      setRecoveryBusy(true);
      const { error } = await supabase.auth.updateUser({ password: p1 });
      if (error) return Alert.alert("Reset failed", error.message);

      Alert.alert("Done ✅", "Password updated. Now log in with the new password.");
      setRecoveryOpen(false);
      setNewPass("");
      setNewPass2("");
      await supabase.auth.signOut();
    } catch (e) {
      Alert.alert("Reset failed", e?.message || String(e));
    } finally {
      setRecoveryBusy(false);
    }
  };

  if (loadingSession) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (recoveryOpen) {
    return (
      <View style={styles.screen}>
        <LinearGradient colors={["#050816", "#0B1220", "#070A12"]} style={styles.bg} />
        <NewYearDecor />
        <View style={[styles.page, { justifyContent: "center" }]}>
          <View style={styles.glassCardDark}>
            <Text style={styles.cardTitle}>Set new password</Text>

            <TextInput
              placeholder="New password"
              placeholderTextColor={PH}
              style={styles.input}
              secureTextEntry
              value={newPass}
              onChangeText={setNewPass}
            />
            <TextInput
              placeholder="Repeat new password"
              placeholderTextColor={PH}
              style={styles.input}
              secureTextEntry
              value={newPass2}
              onChangeText={setNewPass2}
            />

            <Pressable style={[styles.primaryBtn, recoveryBusy && { opacity: 0.7 }]} onPress={confirmReset} disabled={recoveryBusy}>
              <Text style={styles.primaryBtnText}>{recoveryBusy ? "Updating..." : "Update password"}</Text>
              <Ionicons name="checkmark-outline" size={16} color="#0B1220" />
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  if (!session) return <AuthScreen />;

  const confirmed = !!(session?.user?.email_confirmed_at || session?.user?.confirmed_at);
  if (!confirmed) return <VerifyEmailScreen email={session.user.email} />;

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
            return <Ionicons name={map[route.name]} size={size} color={focused ? "#E2E8F0" : "#94A3B8"} />;
          },
        })}
      >
        {/* Dashboard is a Stack: DashboardHome -> DayDetails */}
        <Tab.Screen name="Dashboard">{() => <DashboardStack session={session} />}</Tab.Screen>

        <Tab.Screen name="Workouts">{(p) => <WorkoutsScreen {...p} session={session} />}</Tab.Screen>
        <Tab.Screen name="Profile">{(p) => <ProfileScreen {...p} session={session} />}</Tab.Screen>
      </Tab.Navigator>
    </NavigationContainer>
  );
}

/** =======================
 *  Dashboard stack
 *  ======================= */
function DashboardStack({ session }) {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="DashboardHome">{(p) => <DashboardScreen {...p} session={session} />}</Stack.Screen>
      <Stack.Screen name="DayDetails">{(p) => <DayDetailsScreen {...p} session={session} />}</Stack.Screen>
    </Stack.Navigator>
  );
}

function AuthScreen() {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);

  const [fpOpen, setFpOpen] = useState(false);
  const [fpEmail, setFpEmail] = useState("");
  const [fpBusy, setFpBusy] = useState(false);

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
        Alert.alert("Account created", "Check your email to verify your account, then login.");
        setMode("login");
      }
    }

    setBusy(false);
  };

  const sendReset = async () => {
    const e = (fpEmail || "").trim();
    if (!e) return Alert.alert("Missing", "Enter your email.");

    try {
      setFpBusy(true);

      const redirectTo = "https://erionmustafa.github.io/workout-planner-reset/reset-password.html";
      const { error } = await supabase.auth.resetPasswordForEmail(e, { redirectTo });

      if (error) Alert.alert("Reset failed", error.message);
      else {
        Alert.alert("Email sent", "Open the email link, set new password, then log in.");
        setFpOpen(false);
        setFpEmail("");
      }
    } catch (err) {
      Alert.alert("Reset failed", err?.message || String(err));
    } finally {
      setFpBusy(false);
    }
  };

  return (
    <View style={styles.screen}>
      <LinearGradient colors={["#050816", "#0B1220", "#070A12"]} style={styles.bg} />
      <NewYearDecor />

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

            {mode === "login" && (
              <Pressable
                onPress={() => {
                  setFpEmail(email.trim());
                  setFpOpen(true);
                }}
              >
                <Text style={styles.linkCenter}>Forgot password?</Text>
              </Pressable>
            )}

            <Pressable onPress={() => setMode(mode === "login" ? "register" : "login")}>
              <Text style={styles.linkCenter}>{mode === "login" ? "No account? Register" : "Already have an account? Login"}</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>

      <Modal visible={fpOpen} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Reset password</Text>
              <Pressable style={styles.modalClose} onPress={() => setFpOpen(false)}>
                <Ionicons name="close" size={18} color="#0B1220" />
              </Pressable>
            </View>

            <Text style={styles.modalText}>We’ll send a reset link to your email.</Text>

            <TextInput
              placeholder="Email"
              placeholderTextColor={PH}
              style={styles.input}
              autoCapitalize="none"
              keyboardType="email-address"
              value={fpEmail}
              onChangeText={setFpEmail}
            />

            <Pressable style={[styles.primaryBtn, fpBusy && { opacity: 0.7 }]} onPress={sendReset} disabled={fpBusy}>
              <Text style={styles.primaryBtnText}>{fpBusy ? "Sending..." : "Send reset email"}</Text>
              <Ionicons name="send-outline" size={16} color="#0B1220" />
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

/** =======================
 *  Day details screen
 *  ======================= */
function DayDetailsScreen({ route, session, navigation }) {
  const user = session.user;
  const ymd = route?.params?.ymd || dateToYMD(new Date());
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [workoutsMap, setWorkoutsMap] = useState({});

  const load = async () => {
    setLoading(true);

    const { startISO, endISO } = ymdToBounds(ymd);

    const { data: comps, error } = await supabase
      .from("workout_completions")
      .select("id, workout_id, completed_at")
      .eq("user_id", user.id)
      .gte("completed_at", startISO)
      .lt("completed_at", endISO)
      .order("completed_at", { ascending: false });

    if (error) {
      setLoading(false);
      return Alert.alert("Load failed", error.message);
    }

    const list = comps || [];
    setRows(list);

    const ids = [...new Set(list.map((x) => x.workout_id).filter(Boolean))];
    if (ids.length) {
      const { data: ws } = await supabase
        .from("workouts")
        .select("id, name, image_url, video_url, plan")
        .eq("user_id", user.id)
        .in("id", ids);

      const map = {};
      (ws || []).forEach((w) => (map[w.id] = w));
      setWorkoutsMap(map);
    } else {
      setWorkoutsMap({});
    }

    setLoading(false);
  };

  useEffect(() => {
    load();
  }, [ymd]);

  const label = useMemo(() => {
    const d = new Date(ymd + "T00:00:00");
    return d.toDateString();
  }, [ymd]);

  const goWorkouts = () => {
    // DayDetails is inside Dashboard stack, parent is Tab navigator:
    navigation.getParent()?.navigate("Workouts");
  };

  return (
    <View style={styles.screen}>
      <LinearGradient colors={["#050816", "#0B1220", "#070A12"]} style={styles.bg} />
      <NewYearDecor />

      <View style={[styles.page, { paddingTop: 12 }]}>
        <View style={styles.dayHeader}>
          <Pressable style={styles.iconBtnDark} onPress={() => navigation.goBack()}>
            <Ionicons name="arrow-back" size={18} color="#E2E8F0" />
          </Pressable>

          <View style={{ flex: 1 }}>
            <Text style={styles.hiDark}>Day Details</Text>
            <Text style={styles.smallDark}>{label}</Text>
          </View>

          <Pressable style={styles.iconBtnDark} onPress={load}>
            <Ionicons name="refresh-outline" size={18} color="#E2E8F0" />
          </Pressable>
        </View>

        <View style={styles.sectionCardDark}>
          <View style={styles.rowBetween}>
            <Text style={styles.sectionTitle}>Completions</Text>
            <Text style={styles.smallDark}>{loading ? "..." : String(rows.length)}</Text>
          </View>

          {loading ? (
            <View style={styles.centerGrow}>
              <ActivityIndicator />
            </View>
          ) : rows.length === 0 ? (
            <View style={{ paddingVertical: 8 }}>
              <Text style={[styles.smallDark, { fontWeight: "900" }]}>No completions for this day.</Text>
              <Text style={styles.miniHelp}>Complete a workout and it will appear here.</Text>
            </View>
          ) : (
            rows.map((r) => {
              const w = workoutsMap[r.workout_id];
              const time = new Date(r.completed_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
              return (
                <View key={r.id} style={styles.dayRow}>
                  <View style={styles.dayRowLeft}>
                    <View style={styles.dayDot} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.dayTitle}>{w?.name || "Workout"}</Text>
                      <Text style={styles.daySub}>{`${time} • +10 points`}</Text>
                    </View>
                  </View>

                  <Pressable style={styles.dayOpenBtn} onPress={goWorkouts}>
                    <Ionicons name="barbell-outline" size={16} color="#0B1220" />
                    <Text style={styles.dayOpenText}>Go</Text>
                  </Pressable>
                </View>
              );
            })
          )}

          <Pressable style={[styles.primaryBtn, { marginTop: 10 }]} onPress={goWorkouts}>
            <Text style={styles.primaryBtnText}>Go to workouts</Text>
            <Ionicons name="arrow-forward" size={16} color="#0B1220" />
          </Pressable>
        </View>

        <View style={styles.sectionCardDark}>
          <Text style={styles.sectionTitle}>Mini Insight</Text>
          <Text style={styles.miniHelp}>
            Consistency beats motivation. Your timeline is clickable — use it to track your best days and repeat them.
          </Text>

          <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
            <Chip icon="flame-outline" label="Build streak" subtle onPress={() => {}} />
            <Chip icon="trophy-outline" label="Chase XP" subtle onPress={() => {}} />
          </View>
        </View>
      </View>
    </View>
  );
}

/** =======================
 *  Dashboard
 *  ======================= */
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

  const [completionsRows, setCompletionsRows] = useState([]);

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

    const { data: w } = await supabase.from("workouts").select("id").eq("user_id", user.id);
    setTotalWorkouts((w || []).length);

    const { data: c } = await supabase
      .from("workout_completions")
      .select("id, completed_at, workout_id")
      .eq("user_id", user.id)
      .order("completed_at", { ascending: false });

    const comps = c || [];
    setCompletionsRows(comps);
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

  const xp = useMemo(() => xpFromPoints(points), [points]);

  const timeline = useMemo(() => {
    const map = {};
    (completionsRows || []).forEach((r) => {
      const k = dateToYMD(r.completed_at);
      map[k] = (map[k] || 0) + 1;
    });

    const arr = [];
    const today = new Date();
    for (let i = 13; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const ymd = dateToYMD(d);
      arr.push({
        ymd,
        label: d.toLocaleDateString([], { month: "short", day: "2-digit" }),
        dow: d.toLocaleDateString([], { weekday: "short" }),
        count: map[ymd] || 0,
        isToday: ymd === dateToYMD(today),
      });
    }
    return arr;
  }, [completionsRows]);

  const openDay = (ymd) => {
    navigation.navigate("DayDetails", { ymd });
  };

  const todayYMD = dateToYMD(new Date());

  return (
    <View style={styles.screen}>
      <LinearGradient colors={["#050816", "#0B1220", "#070A12"]} style={styles.bg} />
      <NewYearDecor />

      <ScrollView contentContainerStyle={{ paddingBottom: 110 }}>
        <View style={styles.page}>
          <View style={styles.topRow}>
            <View style={styles.profileMini}>
              <View style={styles.avatarMini}>
                {avatar ? <Image source={{ uri: cacheBust(avatar) }} style={styles.avatarImg} /> : <Ionicons name="person" size={16} color="#E2E8F0" />}
              </View>
              <View>
                <Text style={styles.hiDark}>
                  Welcome{fullName ? `, ${fullName}` : ""}
                </Text>
                <Text style={styles.smallDark} numberOfLines={1}>
                  {user.email}
                </Text>
              </View>
            </View>

            <Pressable style={styles.iconBtnDark} onPress={load}>
              <Ionicons name="refresh-outline" size={18} color="#E2E8F0" />
            </Pressable>
          </View>

          <View style={styles.heroPanelDark}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={styles.heroTitleDark}>DASHBOARD</Text>
              <View style={styles.badgePill}>
                <Ionicons name="flash-outline" size={14} color="#0B1220" />
                <Text style={styles.badgeText}>LVL {xp.level}</Text>
              </View>
            </View>

            <Text style={styles.heroQuoteDark}>Plan. Execute. Repeat.</Text>

            <View style={{ marginTop: 12 }}>
              <View style={styles.rowBetween}>
                <Text style={styles.smallDark}>XP Progress</Text>
                <Text style={styles.smallDark}>{xp.inLevel}/100</Text>
              </View>
              <ProgressBar pct={xp.pct} />
            </View>

            <View style={styles.heroActions}>
              <Pressable style={styles.neonChip} onPress={() => navigation.getParent()?.navigate("Workouts")}>
                <Ionicons name="barbell-outline" size={18} color="#0B1220" />
                <Text style={styles.neonChipText}>Open workouts</Text>
              </Pressable>

              <Pressable style={styles.neonChip} onPress={() => navigation.getParent()?.navigate("Profile")}>
                <Ionicons name="person-outline" size={18} color="#0B1220" />
                <Text style={styles.neonChipText}>Edit profile</Text>
              </Pressable>
            </View>

            <View style={styles.todayCard}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <View style={styles.todayIcon}>
                  <Ionicons name="calendar-outline" size={18} color="#0B1220" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.todayTitle}>Today</Text>
                  <Text style={styles.todaySub}>Tap the timeline dates below to open a day view.</Text>
                </View>
              </View>

              <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
                <Chip
                  icon="time-outline"
                  label={`Open ${new Date().toLocaleDateString([], { month: "short", day: "2-digit" })}`}
                  onPress={() => openDay(todayYMD)}
                />
                <Chip
                  icon="sparkles-outline"
                  label="Boost motivation"
                  subtle
                  onPress={() => Alert.alert("🔥", "Small step now = big result later. Go get it.")}
                />
              </View>
            </View>
          </View>

          <View style={styles.sectionCardDark}>
            <View style={styles.rowBetween}>
              <Text style={styles.sectionTitle}>Timeline</Text>
              <Text style={styles.smallDark}>Last 14 days</Text>
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingVertical: 6, gap: 10 }}>
              {timeline.map((t) => (
                <Pressable
                  key={t.ymd}
                  style={[styles.dayChip, t.isToday && styles.dayChipToday, t.count > 0 && styles.dayChipDone]}
                  onPress={() => openDay(t.ymd)}
                >
                  <Text style={[styles.dayChipDow, t.isToday && { color: "#0B1220" }]}>{t.dow}</Text>
                  <Text style={[styles.dayChipLabel, t.isToday && { color: "#0B1220" }]}>{t.label}</Text>
                  <View style={[styles.dayChipCount, t.count > 0 ? styles.dayChipCountOn : styles.dayChipCountOff]}>
                    <Text style={styles.dayChipCountText}>{t.count}</Text>
                  </View>
                </Pressable>
              ))}
            </ScrollView>

            <Text style={styles.miniHelp}>Click any date → opens “Day Details” with completions + timeline view.</Text>
          </View>

          <View style={styles.statsGrid}>
            <Pressable style={styles.statBoxDark} onPress={() => navigation.getParent()?.navigate("Workouts")}>
              <View style={styles.statTop}>
                <Text style={styles.statLabelDark}>Total workouts</Text>
                <Ionicons name="barbell-outline" size={18} color="#E2E8F0" />
              </View>
              <Text style={styles.statValueDark}>{loading ? "..." : String(totalWorkouts)}</Text>
              <Text style={styles.tapHint}>Tap to view</Text>
            </Pressable>

            <Pressable style={styles.statBoxDark} onPress={() => openDay(todayYMD)}>
              <View style={styles.statTop}>
                <Text style={styles.statLabelDark}>Completions</Text>
                <Ionicons name="checkmark-circle-outline" size={18} color="#E2E8F0" />
              </View>
              <Text style={styles.statValueDark}>{loading ? "..." : String(completionsTotal)}</Text>
              <Text style={styles.tapHint}>Tap → Today details</Text>
            </Pressable>

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

            <TextInput value={goal} onChangeText={setGoal} placeholder="Goal (e.g. Bulk / Cut / Strength)" placeholderTextColor={PH} style={styles.inputDark} />
            <TextInput value={level} onChangeText={setLevel} placeholder="Level (Beginner / Intermediate / Advanced)" placeholderTextColor={PH} style={styles.inputDark} />
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

            <TextInput value={reminderTime} onChangeText={setReminderTime} placeholder="Reminder time HH:MM (e.g. 19:00)" placeholderTextColor={PH} style={styles.inputDark} />

            <Pressable style={[styles.primaryBtn, savingSettings && { opacity: 0.7 }]} onPress={saveSettings} disabled={savingSettings}>
              <Text style={styles.primaryBtnText}>{savingSettings ? "Saving..." : "Save settings"}</Text>
              <Ionicons name="save-outline" size={16} color="#0B1220" />
            </Pressable>
          </View>

          <View style={styles.sectionCardDark}>
            <View style={styles.rowBetween}>
              <Text style={styles.sectionTitle}>Achievements</Text>
              <Text style={styles.smallDark}>
                {earnedCount}/{achievements.length}
              </Text>
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
    </View>
  );
}

/** =======================
 *  Workouts
 *  ======================= */
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
  const [uploadingVideo, setUploadingVideo] = useState(false);

  const [playerOpen, setPlayerOpen] = useState(false);
  const [playerUrl, setPlayerUrl] = useState(null);
  const [playerType, setPlayerType] = useState("youtube");

  const plan = useMemo(() => planText.split("\n").map((l) => l.trim()).filter(Boolean), [planText]);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.from("workouts").select("*").eq("user_id", user.id).order("created_at", { ascending: false });
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
    const asset = await pickImageSquare();
    if (!asset?.uri) return;

    try {
      setUploading(true);

      const ext = (asset.uri.split(".").pop() || "jpg").toLowerCase();
      const fileName = `${Date.now()}.${ext}`;

      const contentType = asset?.mimeType || (ext === "png" ? "image/png" : ext === "heic" ? "image/heic" : "image/jpeg");

      const { publicUrl } = await uploadToBucket(BUCKET_WORKOUT_IMAGES, asset.uri, fileName, contentType);
      setImageUrl(publicUrl);
    } catch (e) {
      Alert.alert("Upload failed", e?.message || String(e));
    } finally {
      setUploading(false);
    }
  };

  const uploadWorkoutVideo = async () => {
    const asset = await pickVideo();
    if (!asset?.uri) return;

    try {
      setUploadingVideo(true);

      const ext = (asset.uri.split(".").pop() || "mp4").toLowerCase();
      const fileName = `${Date.now()}.${ext}`;

      const contentType = asset?.mimeType || (ext === "mov" ? "video/quicktime" : "video/mp4");

      const { publicUrl } = await uploadToBucket(BUCKET_WORKOUT_VIDEOS, asset.uri, fileName, contentType);
      setVideoUrl(publicUrl);
      Alert.alert("Uploaded ✅", "Video uploaded. It will play directly in the app.");
    } catch (e) {
      Alert.alert("Video upload failed", e?.message || String(e));
    } finally {
      setUploadingVideo(false);
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
    if (!url) return Alert.alert("No video", "This workout has no video.");

    if (isYouTubeUrl(url)) {
      const embed = ytToEmbed(url);
      if (!embed) return Alert.alert("Invalid link", "Paste a valid YouTube URL.");
      setPlayerType("youtube");
      setPlayerUrl(embed);
      setPlayerOpen(true);
      return;
    }

    setPlayerType("direct");
    setPlayerUrl(url);
    setPlayerOpen(true);
  };

  const awardPoints = async (add) => {
    const { data: setg } = await supabase.from("user_settings").select("points").eq("user_id", user.id).maybeSingle();
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
    <View style={styles.screen}>
      <LinearGradient colors={["#050816", "#0B1220", "#070A12"]} style={styles.bg} />
      <NewYearDecor />
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
          <View style={styles.centerGrow}>
            <ActivityIndicator />
          </View>
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
                    <Text style={styles.workoutTitleDark} numberOfLines={1}>
                      {item.name}
                    </Text>
                    <Text style={styles.smallDark} numberOfLines={2}>
                      {(item.plan || []).join(" • ")}
                    </Text>

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
        <View style={styles.screen}>
          <LinearGradient colors={["#050816", "#0B1220", "#070A12"]} style={styles.bg} />
          <NewYearDecor />
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

              <TextInput
                value={videoUrl}
                onChangeText={setVideoUrl}
                placeholder="YouTube URL or Direct video URL (optional)"
                placeholderTextColor={PH}
                autoCapitalize="none"
                style={styles.inputDark}
              />

              <Pressable style={[styles.neonBtn, uploadingVideo && { opacity: 0.7 }]} onPress={uploadWorkoutVideo} disabled={uploadingVideo}>
                <Ionicons name="videocam-outline" size={18} color="#0B1220" />
                <Text style={styles.neonBtnText}>{uploadingVideo ? "Uploading..." : "Upload video (plays in-app)"}</Text>
              </Pressable>

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
        </View>
      </Modal>

      <Modal visible={playerOpen} animationType="slide">
        <View style={styles.playerScreen}>
          <View style={styles.playerHeader}>
            <Pressable style={styles.iconBtnDark} onPress={() => setPlayerOpen(false)}>
              <Ionicons name="close" size={18} color="#E2E8F0" />
            </Pressable>
            <Text style={styles.playerTitleDark}>Video Demo</Text>
            <View style={{ width: 44 }} />
          </View>

          {playerUrl ? (
            playerType === "youtube" ? (
              <WebView
                source={{ uri: playerUrl }}
                style={{ flex: 1 }}
                javaScriptEnabled
                domStorageEnabled
                originWhitelist={["*"]}
                allowsFullscreenVideo
              />
            ) : (
              <View style={{ flex: 1, padding: 12 }}>
                <Video
                  source={{ uri: playerUrl }}
                  style={{ flex: 1, borderRadius: 16, overflow: "hidden" }}
                  useNativeControls
                  resizeMode="contain"
                  shouldPlay
                />
              </View>
            )
          ) : (
            <View style={styles.center}>
              <Text>No video</Text>
            </View>
          )}
        </View>
      </Modal>
    </View>
  );
}

/** =======================
 *  Profile (FIXED NAV)
 *  ======================= */
function ProfileScreen({ session, navigation }) {
  const user = session.user;
  const todayYMD = dateToYMD(new Date());

  const [loading, setLoading] = useState(true);
  const [fullName, setFullName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [points, setPoints] = useState(0);
  const [streak, setStreak] = useState(0);
  const [totalWorkouts, setTotalWorkouts] = useState(0);
  const [completionsTotal, setCompletionsTotal] = useState(0);

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

    const { data: prof } = await supabase.from("profiles").select("full_name, avatar_url").eq("user_id", user.id).maybeSingle();
    setFullName(prof?.full_name || "");
    setAvatarUrl(prof?.avatar_url || null);

    const { data: setg } = await supabase.from("user_settings").select("points").eq("user_id", user.id).maybeSingle();
    const pts = Number.isFinite(setg?.points) ? setg.points : 0;
    setPoints(pts);

    const { data: w } = await supabase.from("workouts").select("id").eq("user_id", user.id);
    setTotalWorkouts((w || []).length);

    const { data: c } = await supabase
      .from("workout_completions")
      .select("id, completed_at")
      .eq("user_id", user.id)
      .order("completed_at", { ascending: false });

    const comps = c || [];
    setCompletionsTotal(comps.length);
    setStreak(calcStreakFromCompletions(comps));

    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const xp = useMemo(() => xpFromPoints(points), [points]);

  const uploadAvatar = async () => {
    const asset = await pickImageSquare();
    if (!asset?.uri) return;

    try {
      setUploading(true);

      const ext = (asset.uri.split(".").pop() || "jpg").toLowerCase();
      const contentType = asset?.mimeType || (ext === "png" ? "image/png" : ext === "heic" ? "image/heic" : "image/jpeg");

      const { publicUrl } = await uploadToBucket(BUCKET_AVATARS, asset.uri, "avatar." + ext, contentType);

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

  // ✅ REAL NAV:
  const openTodayTimeline = () => {
    // Profile is a Tab screen; parent is Tab navigator.
    // Navigate to Dashboard tab, then to DayDetails inside DashboardStack:
    navigation.getParent()?.navigate("Dashboard", {
      screen: "DayDetails",
      params: { ymd: todayYMD },
    });
  };

  const goToWorkouts = () => {
    navigation.getParent()?.navigate("Workouts");
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <LinearGradient colors={["#050816", "#0B1220", "#070A12"]} style={styles.bg} />
      <NewYearDecor />
      <ScrollView contentContainerStyle={{ paddingBottom: 110 }}>
        <View style={styles.page}>
          <View style={styles.topRow}>
            <View>
              <Text style={styles.hiDark}>Profile</Text>
              <Text style={styles.smallDark} numberOfLines={1}>
                {user.email}
              </Text>
            </View>

            <Pressable style={styles.iconBtnDark} onPress={load}>
              <Ionicons name="refresh-outline" size={18} color="#E2E8F0" />
            </Pressable>
          </View>

          <View style={styles.profileHero}>
            <View style={styles.profileHeroTop}>
              <View style={styles.avatarBig}>
                {avatarUrl ? <Image source={{ uri: cacheBust(avatarUrl) }} style={styles.avatarBigImg} /> : <Ionicons name="person" size={28} color="#E2E8F0" />}
              </View>

              <View style={{ flex: 1 }}>
                <Text style={styles.profileName}>{fullName || "Unnamed Athlete"}</Text>
                <View style={{ flexDirection: "row", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
                  <View style={styles.tag}>
                    <Ionicons name="flash-outline" size={14} color="#0B1220" />
                    <Text style={styles.tagText}>Level {xp.level}</Text>
                  </View>
                  <View style={styles.tag}>
                    <Ionicons name="flame-outline" size={14} color="#0B1220" />
                    <Text style={styles.tagText}>{streak}d streak</Text>
                  </View>
                  <View style={styles.tag}>
                    <Ionicons name="trophy-outline" size={14} color="#0B1220" />
                    <Text style={styles.tagText}>{points} pts</Text>
                  </View>
                </View>
              </View>
            </View>

            <View style={{ marginTop: 14 }}>
              <View style={styles.rowBetween}>
                <Text style={styles.smallDark}>XP Progress</Text>
                <Text style={styles.smallDark}>{xp.inLevel}/100</Text>
              </View>
              <ProgressBar pct={xp.pct} />
            </View>

            <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
             <Chip
  icon="calendar-outline"
  label="Open Today timeline"
  onPress={() =>
    navigation.navigate("Dashboard", {
      screen: "DayDetails",
      params: { ymd: todayYMD },
    })
  }
/>

<Chip
  icon="barbell-outline"
  label="Go to workouts"
  subtle
  onPress={() => navigation.navigate("Workouts")}
/>
            </View>
          </View>

          <View style={styles.profileCardDark}>
            <Text style={styles.sectionTitle}>Edit</Text>

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

            <View style={styles.profileStatsGrid}>
              <View style={styles.profileStat}>
                <Text style={styles.profileStatLabel}>Workouts</Text>
                <Text style={styles.profileStatValue}>{totalWorkouts}</Text>
              </View>
              <View style={styles.profileStat}>
                <Text style={styles.profileStatLabel}>Completions</Text>
                <Text style={styles.profileStatValue}>{completionsTotal}</Text>
              </View>
              <View style={styles.profileStat}>
                <Text style={styles.profileStatLabel}>Streak</Text>
                <Text style={styles.profileStatValue}>{streak}d</Text>
              </View>
              <View style={styles.profileStat}>
                <Text style={styles.profileStatLabel}>Points</Text>
                <Text style={styles.profileStatValue}>{points}</Text>
              </View>
            </View>

            <Pressable style={styles.logoutBtn} onPress={logout}>
              <Text style={styles.logoutText}>Logout</Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

/** =======================
 *  Styles
 *  ======================= */
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
  heroTitleDark: { fontSize: 12, fontWeight: "900", color: "rgba(226,232,240,0.75)", letterSpacing: 1.2 },
  heroQuoteDark: { marginTop: 8, fontSize: 18, fontWeight: "900", color: "#E2E8F0" },
  heroActions: { flexDirection: "row", gap: 10, marginTop: 12 },

  neonChip: { flex: 1, backgroundColor: "rgba(34,211,238,0.92)", paddingVertical: 10, borderRadius: 16, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8 },
  neonChipText: { fontWeight: "900", color: "#0B1220" },

  badgePill: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(34,211,238,0.92)", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 },
  badgeText: { color: "#0B1220", fontWeight: "900", fontSize: 12 },

  todayCard: { marginTop: 14, backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: "rgba(148,163,184,0.14)", borderRadius: 18, padding: 12 },
  todayIcon: { width: 34, height: 34, borderRadius: 14, backgroundColor: "rgba(236,72,153,0.92)", alignItems: "center", justifyContent: "center" },
  todayTitle: { fontWeight: "900", color: "#E2E8F0" },
  todaySub: { marginTop: 2, color: "#94A3B8", fontWeight: "800", fontSize: 12 },

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
  miniHelp: { fontSize: 11, color: "rgba(226,232,240,0.6)", fontWeight: "800", marginTop: 6 },

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

  modalOverlay: { flex: 1, backgroundColor: "rgba(2,6,23,0.72)", justifyContent: "center", padding: 16 },
  modalCard: { backgroundColor: "rgba(255,255,255,0.92)", borderRadius: 20, padding: 14, borderWidth: 1, borderColor: "rgba(15,23,42,0.10)" },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  modalTitle: { fontWeight: "900", color: "#0B1220", fontSize: 16 },
  modalClose: { width: 38, height: 38, borderRadius: 14, backgroundColor: "rgba(15,23,42,0.06)", alignItems: "center", justifyContent: "center" },
  modalText: { color: "#0B1220", opacity: 0.75, fontWeight: "800", marginBottom: 10 },

  nyOrb1: { position: "absolute", width: 220, height: 220, borderRadius: 999, top: -60, left: -70, backgroundColor: "rgba(236,72,153,0.14)", transform: [{ rotate: "18deg" }] },
  nyOrb2: { position: "absolute", width: 260, height: 260, borderRadius: 999, bottom: 140, right: -90, backgroundColor: "rgba(34,211,238,0.12)", transform: [{ rotate: "-12deg" }] },
  nyOrb3: { position: "absolute", width: 140, height: 140, borderRadius: 999, bottom: 40, left: 20, backgroundColor: "rgba(226,232,240,0.06)" },
  nySparkRow: { position: "absolute", top: 14, right: 14, flexDirection: "row", gap: 10, opacity: 0.9 },

  pbOuter: { height: 10, borderRadius: 999, backgroundColor: "rgba(226,232,240,0.10)", overflow: "hidden", borderWidth: 1, borderColor: "rgba(148,163,184,0.14)" },
  pbInner: { height: "100%", borderRadius: 999, backgroundColor: "rgba(34,211,238,0.92)" },

  chip: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "rgba(34,211,238,0.92)", paddingHorizontal: 12, paddingVertical: 10, borderRadius: 16, flex: 1 },
  chipSubtle: { backgroundColor: "rgba(255,255,255,0.08)", borderWidth: 1, borderColor: "rgba(148,163,184,0.16)" },
  chipText: { fontWeight: "900", color: "#0B1220", flex: 1 },

  dayChip: { width: 92, borderRadius: 18, padding: 10, backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: "rgba(148,163,184,0.14)", alignItems: "center" },
  dayChipToday: { backgroundColor: "rgba(34,211,238,0.92)", borderColor: "rgba(34,211,238,0.92)" },
  dayChipDone: { borderColor: "rgba(236,72,153,0.35)" },
  dayChipDow: { fontSize: 11, color: "#94A3B8", fontWeight: "900" },
  dayChipLabel: { marginTop: 4, fontSize: 13, color: "#E2E8F0", fontWeight: "900" },
  dayChipCount: { marginTop: 8, minWidth: 36, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  dayChipCountOn: { backgroundColor: "rgba(236,72,153,0.92)" },
  dayChipCountOff: { backgroundColor: "rgba(226,232,240,0.08)", borderWidth: 1, borderColor: "rgba(148,163,184,0.14)" },
  dayChipCountText: { fontWeight: "900", color: "#0B1220" },

  dayHeader: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 10 },
  dayRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 10, borderTopWidth: 1, borderTopColor: "rgba(148,163,184,0.12)" },
  dayRowLeft: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  dayDot: { width: 10, height: 10, borderRadius: 999, backgroundColor: "rgba(34,211,238,0.92)" },
  dayTitle: { fontWeight: "900", color: "#E2E8F0" },
  daySub: { marginTop: 2, fontWeight: "800", color: "#94A3B8", fontSize: 12 },
  dayOpenBtn: { backgroundColor: "rgba(34,211,238,0.92)", borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 6 },
  dayOpenText: { fontWeight: "900", color: "#0B1220" },

  profileHero: { backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 22, padding: 16, borderWidth: 1, borderColor: "rgba(148,163,184,0.16)" },
  profileHeroTop: { flexDirection: "row", alignItems: "center", gap: 14 },
  profileName: { fontSize: 18, fontWeight: "900", color: "#E2E8F0" },
  tag: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(34,211,238,0.92)", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 },
  tagText: { color: "#0B1220", fontWeight: "900", fontSize: 12 },

  profileStatsGrid: { marginTop: 12, flexDirection: "row", flexWrap: "wrap", gap: 10 },
  profileStat: { width: "47.5%", backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: "rgba(148,163,184,0.14)", borderRadius: 18, padding: 12 },
  profileStatLabel: { color: "#94A3B8", fontWeight: "900", fontSize: 12 },
  profileStatValue: { marginTop: 8, color: "#E2E8F0", fontWeight: "900", fontSize: 18 },
});
