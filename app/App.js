import "react-native-gesture-handler";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
  KeyboardAvoidingView,
  Platform,
  Modal,
} from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "./supabaseClient";

const Tab = createBottomTabNavigator();

export default function App() {
  const [session, setSession] = useState(null);
  const [loadingSession, setLoadingSession] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoadingSession(false);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_e, session) => {
      setSession(session);
    });

    return () => subscription.subscription.unsubscribe();
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
          tabBarIcon: ({ focused, color, size }) => {
            const map = {
              Dashboard: focused ? "grid" : "grid-outline",
              Workouts: focused ? "barbell" : "barbell-outline",
              Profile: focused ? "person" : "person-outline",
            };
            return <Ionicons name={map[route.name]} size={size} color={focused ? "#111827" : "#6b7280"} />;
          },
        })}
      >
        <Tab.Screen name="Dashboard">
          {(props) => <DashboardScreen {...props} session={session} />}
        </Tab.Screen>

        <Tab.Screen name="Workouts">
          {(props) => <WorkoutsScreen {...props} session={session} />}
        </Tab.Screen>

        <Tab.Screen name="Profile">
          {(props) => <ProfileScreen {...props} session={session} />}
        </Tab.Screen>
      </Tab.Navigator>
    </NavigationContainer>
  );
}

function AuthScreen() {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!email || !password) return;

    setBusy(true);
    if (mode === "login") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) Alert.alert("Login failed", error.message);
    } else {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) Alert.alert("Register failed", error.message);
      else {
        Alert.alert("Account created", "You can login now.");
        setMode("login");
      }
    }
    setBusy(false);
  };

  return (
    <SafeAreaView style={styles.screen}>
      <LinearGradient colors={["#eef2ff", "#f5f3ff", "#ffffff"]} style={styles.bg} />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.centerBlock}>
          <View style={styles.brandRow}>
            <View style={styles.logoCircle}>
              <Ionicons name="barbell" size={20} color="#111827" />
            </View>
            <Text style={styles.brand}>Workout Planner</Text>
          </View>

          <Text style={styles.heroTitle}>
            Plan. Track. Improve.
          </Text>
          <Text style={styles.heroSub}>
            Simple workouts + history — tied to your account.
          </Text>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>{mode === "login" ? "Login" : "Register"}</Text>

            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="Email"
              autoCapitalize="none"
              style={styles.input}
            />
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder="Password"
              secureTextEntry
              style={styles.input}
            />

            <Pressable
              style={[styles.primaryBtn, busy && { opacity: 0.7 }]}
              onPress={submit}
              disabled={busy}
            >
              <Text style={styles.primaryBtnText}>
                {busy ? "Please wait..." : mode === "login" ? "Login" : "Create account"}
              </Text>
            </Pressable>

            <Pressable onPress={() => setMode(mode === "login" ? "register" : "login")}>
              <Text style={styles.linkCenter}>
                {mode === "login" ? "No account? Create one" : "Already have an account? Login"}
              </Text>
            </Pressable>
          </View>

          <Text style={styles.miniNote}>
            Built with React Native (Expo) + Supabase Auth/DB.
          </Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function DashboardScreen({ session, navigation }) {
  const user = session.user;

  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [lastName, setLastName] = useState("-");
  const [lastDate, setLastDate] = useState("-");
  const [quote, setQuote] = useState("Discipline beats motivation.");

  const loadStats = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("workouts")
      .select("id,name,created_at")
      .order("created_at", { ascending: false });

    if (!error) {
      const rows = data || [];
      setTotal(rows.length);
      if (rows[0]) {
        setLastName(rows[0].name || "-");
        const d = new Date(rows[0].created_at);
        setLastDate(d.toLocaleDateString());
      } else {
        setLastName("-");
        setLastDate("-");
      }
    }
    setLoading(false);
  };

  useEffect(() => {
    loadStats();
  }, []);

  return (
    <SafeAreaView style={styles.screen}>
      <LinearGradient colors={["#e0f2fe", "#eef2ff", "#ffffff"]} style={styles.bg} />
      <View style={styles.page}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.hi}>Welcome back</Text>
            <Text style={styles.userEmail} numberOfLines={1}>{user.email}</Text>
          </View>
          <View style={styles.headerIcon}>
            <Ionicons name="sparkles" size={18} color="#111827" />
          </View>
        </View>

        <View style={styles.heroCard}>
          <Text style={styles.heroCardTitle}>Today’s Focus</Text>
          <Text style={styles.heroCardText}>{quote}</Text>

          <View style={styles.heroActions}>
            <Pressable style={styles.secondaryBtn} onPress={() => navigation.navigate("Workouts")}>
              <Ionicons name="add-circle-outline" size={18} color="#111827" />
              <Text style={styles.secondaryBtnText}>Add workout</Text>
            </Pressable>

            <Pressable style={styles.secondaryBtn} onPress={loadStats}>
              <Ionicons name="refresh-outline" size={18} color="#111827" />
              <Text style={styles.secondaryBtnText}>Refresh</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.grid}>
          <StatCard title="Total workouts" value={loading ? "..." : String(total)} icon="barbell-outline" />
          <StatCard title="Last workout" value={loading ? "..." : lastName} icon="time-outline" />
          <StatCard title="Last date" value={loading ? "..." : lastDate} icon="calendar-outline" />
          <StatCard title="Security" value="RLS enabled" icon="shield-checkmark-outline" />
        </View>

        <View style={styles.bigTip}>
          <Ionicons name="bulb-outline" size={18} color="#111827" />
          <Text style={styles.bigTipText}>
            Tip: Write each exercise on a new line so your plan stays clean in history.
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

function StatCard({ title, value, icon }) {
  return (
    <View style={styles.statCard}>
      <View style={styles.statTop}>
        <Text style={styles.statTitle}>{title}</Text>
        <Ionicons name={icon} size={18} color="#111827" />
      </View>
      <Text style={styles.statValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function WorkoutsScreen({ session }) {
  const user = session.user;

  const [workouts, setWorkouts] = useState([]);
  const [loading, setLoading] = useState(true);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [name, setName] = useState("");
  const [planText, setPlanText] = useState("");

  const plan = useMemo(
    () => planText.split("\n").map((l) => l.trim()).filter(Boolean),
    [planText]
  );

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("workouts")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) Alert.alert("Load failed", error.message);
    setWorkouts(data || []);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const openCreate = () => {
    setEditingId(null);
    setName("");
    setPlanText("");
    setModalOpen(true);
  };

  const openEdit = (w) => {
    setEditingId(w.id);
    setName(w.name || "");
    setPlanText((w.plan || []).join("\n"));
    setModalOpen(true);
  };

  const save = async () => {
    if (!name.trim()) return Alert.alert("Missing", "Enter a workout name.");
    if (plan.length === 0) return Alert.alert("Missing", "Add at least 1 plan line.");

    if (editingId) {
      const { error } = await supabase
        .from("workouts")
        .update({ name: name.trim(), plan })
        .eq("id", editingId);

      if (error) return Alert.alert("Update failed", error.message);
    } else {
      const { error } = await supabase.from("workouts").insert({
        name: name.trim(),
        plan,
        user_id: user.id,
      });

      if (error) return Alert.alert("Create failed", error.message);
    }

    setModalOpen(false);
    setEditingId(null);
    setName("");
    setPlanText("");
    load();
  };

  const remove = (id) => {
    Alert.alert("Delete workout?", "This action can’t be undone.", [
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

  return (
    <SafeAreaView style={styles.screen}>
      <LinearGradient colors={["#fef3c7", "#eef2ff", "#ffffff"]} style={styles.bg} />
      <View style={styles.page}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.hi}>Workouts</Text>
            <Text style={styles.smallSub}>Create, edit, delete — saved to Supabase</Text>
          </View>
          <Pressable style={styles.fab} onPress={openCreate}>
            <Ionicons name="add" size={22} color="#fff" />
          </Pressable>
        </View>

        {loading ? (
          <View style={styles.centerGrow}>
            <ActivityIndicator />
          </View>
        ) : (
          <FlatList
            data={workouts}
            keyExtractor={(item) => String(item.id)}
            contentContainerStyle={{ paddingBottom: 90 }}
            ListEmptyComponent={
              <View style={styles.emptyBox}>
                <Ionicons name="fitness-outline" size={26} color="#111827" />
                <Text style={styles.emptyTitle}>No workouts yet</Text>
                <Text style={styles.emptyText}>Tap + to add your first plan.</Text>
                <Pressable style={styles.primaryBtn} onPress={openCreate}>
                  <Text style={styles.primaryBtnText}>Create workout</Text>
                </Pressable>
              </View>
            }
            renderItem={({ item }) => (
              <View style={styles.workoutCard}>
                <View style={styles.workoutTop}>
                  <Text style={styles.workoutName} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <View style={styles.pill}>
                    <Text style={styles.pillText}>{(item.plan || []).length} items</Text>
                  </View>
                </View>

                <Text style={styles.workoutPlan} numberOfLines={2}>
                  {(item.plan || []).join(" • ")}
                </Text>

                <View style={styles.rowActions}>
                  <Pressable style={styles.actionBtn} onPress={() => openEdit(item)}>
                    <Ionicons name="create-outline" size={18} color="#111827" />
                    <Text style={styles.actionText}>Edit</Text>
                  </Pressable>

                  <Pressable style={[styles.actionBtn, { backgroundColor: "#fee2e2" }]} onPress={() => remove(item.id)}>
                    <Ionicons name="trash-outline" size={18} color="#991b1b" />
                    <Text style={[styles.actionText, { color: "#991b1b" }]}>Delete</Text>
                  </Pressable>
                </View>
              </View>
            )}
          />
        )}
      </View>

      <Modal visible={modalOpen} animationType="slide" transparent>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{editingId ? "Edit workout" : "New workout"}</Text>

            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Workout name (e.g. Push Day)"
              style={styles.input}
            />
            <TextInput
              value={planText}
              onChangeText={setPlanText}
              placeholder={"Plan (one per line)\nBench 3x8\nIncline 3x10"}
              multiline
              style={[styles.input, { height: 120, textAlignVertical: "top" }]}
            />

            <View style={styles.modalRow}>
              <Pressable style={styles.ghostBtn} onPress={() => setModalOpen(false)}>
                <Text style={styles.ghostText}>Cancel</Text>
              </Pressable>
              <Pressable style={styles.primaryBtn} onPress={save}>
                <Text style={styles.primaryBtnText}>{editingId ? "Save" : "Create"}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function ProfileScreen({ session }) {
  const user = session.user;

  const logout = async () => {
    await supabase.auth.signOut();
  };

  return (
    <SafeAreaView style={styles.screen}>
      <LinearGradient colors={["#dcfce7", "#eef2ff", "#ffffff"]} style={styles.bg} />
      <View style={styles.page}>
        <View style={styles.profileCard}>
          <View style={styles.profileIcon}>
            <Ionicons name="person" size={22} color="#111827" />
          </View>
          <Text style={styles.profileTitle}>Profile</Text>
          <Text style={styles.profileEmail}>{user.email}</Text>

          <View style={styles.profileLine} />
          <Text style={styles.profileHint}>
            Your workouts are secured with Supabase Row Level Security (RLS).
          </Text>

          <Pressable style={[styles.primaryBtn, { marginTop: 14 }]} onPress={logout}>
            <Text style={styles.primaryBtnText}>Logout</Text>
          </Pressable>
        </View>

        <View style={styles.proNotes}>
          <Text style={styles.proNotesTitle}>Presentation Tips</Text>
          <Text style={styles.proNotesText}>• Show Login/Register (Auth)</Text>
          <Text style={styles.proNotesText}>• Add a workout live (Create)</Text>
          <Text style={styles.proNotesText}>• Edit + Delete (Update/Delete)</Text>
          <Text style={styles.proNotesText}>• Explain RLS: users only see their own data</Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  screen: { flex: 1, backgroundColor: "#f4f5f7" },
  bg: { ...StyleSheet.absoluteFillObject },

  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  centerGrow: { flex: 1, justifyContent: "center", alignItems: "center" },

  page: { flex: 1, padding: 16 },

  centerBlock: { flex: 1, justifyContent: "center" },

  brandRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: 10 },
  logoCircle: {
    width: 34,
    height: 34,
    borderRadius: 999,
    backgroundColor: "rgba(17,24,39,0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
  brand: { fontSize: 16, fontWeight: "800", color: "#111827" },

  heroTitle: { fontSize: 30, fontWeight: "900", textAlign: "center", color: "#111827" },
  heroSub: { marginTop: 8, fontSize: 14, textAlign: "center", color: "#374151", marginBottom: 16 },

  miniNote: { marginTop: 12, textAlign: "center", color: "#6b7280", fontSize: 12 },

  card: {
    backgroundColor: "rgba(255,255,255,0.95)",
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: "rgba(17,24,39,0.06)",
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
  },
  cardTitle: { fontSize: 16, fontWeight: "800", color: "#111827", marginBottom: 12 },

  input: {
    borderWidth: 1,
    borderColor: "rgba(17,24,39,0.12)",
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
    backgroundColor: "#fff",
  },

  primaryBtn: {
    backgroundColor: "#111827",
    paddingVertical: 12,
    borderRadius: 14,
    alignItems: "center",
    marginTop: 6,
  },
  primaryBtnText: { color: "#fff", fontWeight: "800" },

  linkCenter: { color: "#2563eb", fontWeight: "700", textAlign: "center", marginTop: 12 },

  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
  hi: { fontSize: 18, fontWeight: "900", color: "#111827" },
  smallSub: { fontSize: 12, color: "#6b7280", marginTop: 2 },
  userEmail: { fontSize: 12, color: "#6b7280", marginTop: 2, maxWidth: 220 },

  headerIcon: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: "rgba(17,24,39,0.08)",
    alignItems: "center",
    justifyContent: "center",
  },

  heroCard: {
    backgroundColor: "rgba(255,255,255,0.92)",
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: "rgba(17,24,39,0.06)",
    marginBottom: 14,
  },
  heroCardTitle: { fontSize: 14, fontWeight: "900", color: "#111827" },
  heroCardText: { marginTop: 8, fontSize: 16, fontWeight: "800", color: "#111827" },

  heroActions: { flexDirection: "row", gap: 10, marginTop: 12 },
  secondaryBtn: {
    flex: 1,
    backgroundColor: "rgba(17,24,39,0.06)",
    paddingVertical: 10,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  secondaryBtnText: { fontWeight: "800", color: "#111827" },

  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  statCard: {
    width: "47.5%",
    backgroundColor: "rgba(255,255,255,0.92)",
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: "rgba(17,24,39,0.06)",
  },
  statTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  statTitle: { color: "#6b7280", fontSize: 12, fontWeight: "700" },
  statValue: { marginTop: 10, fontSize: 18, fontWeight: "900", color: "#111827" },

  bigTip: {
    marginTop: 14,
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-start",
    backgroundColor: "rgba(255,255,255,0.92)",
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: "rgba(17,24,39,0.06)",
  },
  bigTipText: { flex: 1, color: "#111827", fontWeight: "700" },

  tabBar: {
    height: 64,
    borderTopWidth: 0,
    backgroundColor: "rgba(255,255,255,0.92)",
    position: "absolute",
    left: 14,
    right: 14,
    bottom: 14,
    borderRadius: 18,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
  },

  fab: {
    width: 46,
    height: 46,
    borderRadius: 16,
    backgroundColor: "#111827",
    alignItems: "center",
    justifyContent: "center",
  },

  emptyBox: {
    marginTop: 24,
    backgroundColor: "rgba(255,255,255,0.92)",
    borderRadius: 20,
    padding: 18,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(17,24,39,0.06)",
  },
  emptyTitle: { marginTop: 8, fontSize: 16, fontWeight: "900", color: "#111827" },
  emptyText: { marginTop: 6, color: "#6b7280", textAlign: "center", marginBottom: 12 },

  workoutCard: {
    backgroundColor: "rgba(255,255,255,0.92)",
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: "rgba(17,24,39,0.06)",
    marginBottom: 12,
  },
  workoutTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  workoutName: { fontSize: 16, fontWeight: "900", color: "#111827", maxWidth: 220 },
  pill: {
    backgroundColor: "rgba(17,24,39,0.08)",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  pillText: { fontWeight: "800", color: "#111827", fontSize: 12 },
  workoutPlan: { marginTop: 10, color: "#374151", fontWeight: "700" },

  rowActions: { flexDirection: "row", gap: 10, marginTop: 12 },
  actionBtn: {
    flex: 1,
    backgroundColor: "rgba(17,24,39,0.06)",
    paddingVertical: 10,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  actionText: { fontWeight: "900", color: "#111827" },

  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(17,24,39,0.45)",
    justifyContent: "center",
    padding: 16,
  },
  modalCard: {
    backgroundColor: "#fff",
    borderRadius: 20,
    padding: 16,
  },
  modalTitle: { fontSize: 16, fontWeight: "900", marginBottom: 12, color: "#111827" },
  modalRow: { flexDirection: "row", gap: 10, marginTop: 6 },
  ghostBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 14,
    alignItems: "center",
    backgroundColor: "rgba(17,24,39,0.06)",
  },
  ghostText: { fontWeight: "900", color: "#111827" },

  profileCard: {
    backgroundColor: "rgba(255,255,255,0.92)",
    borderRadius: 22,
    padding: 18,
    borderWidth: 1,
    borderColor: "rgba(17,24,39,0.06)",
    alignItems: "center",
    marginTop: 20,
  },
  profileIcon: {
    width: 46,
    height: 46,
    borderRadius: 16,
    backgroundColor: "rgba(17,24,39,0.08)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  profileTitle: { fontSize: 18, fontWeight: "900", color: "#111827" },
  profileEmail: { marginTop: 4, color: "#6b7280", fontWeight: "700" },
  profileLine: { width: "100%", height: 1, backgroundColor: "rgba(17,24,39,0.08)", marginVertical: 12 },
  profileHint: { textAlign: "center", color: "#374151", fontWeight: "700" },

  proNotes: {
    marginTop: 14,
    backgroundColor: "rgba(255,255,255,0.92)",
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: "rgba(17,24,39,0.06)",
  },
  proNotesTitle: { fontWeight: "900", color: "#111827", marginBottom: 8 },
  proNotesText: { color: "#374151", fontWeight: "700", marginTop: 4 },
});
