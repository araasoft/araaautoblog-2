import { Navigate, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import Skeleton from "./components/Skeleton";
import { useAuth } from "./hooks/useAuth";
import Login from "./pages/Login";
import Pending from "./pages/Pending";
import Home from "./pages/Home";
import Create from "./pages/Create";
import Posts from "./pages/Posts";
import PostDetail from "./pages/PostDetail";
import News from "./pages/News";
import Agent from "./pages/Agent";
import Brand from "./pages/Brand";
import Activity from "./pages/Activity";
import Users from "./pages/Users";
import UserDetail from "./pages/UserDetail";
import Settings from "./pages/Settings";
import Automation from "./pages/Automation";
import Analytics from "./pages/Analytics";
import Ai from "./pages/Ai";
import Mail from "./pages/Mail";
import Profile from "./pages/Profile";
import AddUser from "./pages/AddUser";
import Notifications from "./pages/Notifications";
import Gate from "./components/Gate";

export default function App() {
  const { me, loading } = useAuth();

  if (loading)
    return (
      <div style={{ padding: 24, maxWidth: 480, margin: "0 auto" }}>
        <Skeleton n={3} />
      </div>
    );
  if (!me) return <Login />;
  if (me.role === "pending") return <Pending />;

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Navigate to="/home" replace />} />
        <Route path="home" element={<Home />} />
        <Route path="create" element={<Gate perm="post.create"><Create /></Gate>} />
        <Route path="posts" element={<Posts />} />
        <Route path="post/:key" element={<PostDetail />} />
        <Route path="analytics" element={<Gate perm="analytics.view"><Analytics /></Gate>} />
        <Route path="news" element={<Gate perm="news.view"><News /></Gate>} />
        <Route path="ai" element={<Gate perm="analytics.view"><Ai /></Gate>} />
        <Route path="agent" element={<Gate perm="ai.use"><Agent /></Gate>} />
        <Route path="brand" element={<Gate perm="brand.edit"><Brand /></Gate>} />
        <Route path="mail" element={<Gate perm="mail.manage"><Mail /></Gate>} />
        <Route path="activity" element={<Gate perm="activity.view"><Activity /></Gate>} />
        <Route path="users" element={<Gate perm="users.view"><Users /></Gate>} />
        <Route path="user/:uid" element={<Gate perm="users.view"><UserDetail /></Gate>} />
        <Route path="adduser" element={<Gate perm="users.manage"><AddUser /></Gate>} />
        <Route path="profile" element={<Profile />} />
        <Route path="notifications" element={<Notifications />} />
        <Route path="settings" element={<Gate perm="settings.edit"><Settings /></Gate>} />
        <Route path="auto" element={<Gate perm="automation.control"><Automation /></Gate>} />
        <Route path="*" element={<Navigate to="/home" replace />} />
      </Route>
    </Routes>
  );
}
