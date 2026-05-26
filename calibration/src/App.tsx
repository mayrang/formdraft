import { BrowserRouter, Routes, Route, Link } from "react-router-dom";
import SignupWizard from "./scenarios/SignupWizard";
import ProfileSettings from "./scenarios/ProfileSettings";
import CommentEditor from "./scenarios/CommentEditor";

export default function App() {
  return (
    <BrowserRouter>
      <nav>
        <Link to="/signup">Signup</Link>{" | "}
        <Link to="/profile">Profile</Link>{" | "}
        <Link to="/comment">Comment</Link>
      </nav>
      <Routes>
        <Route path="/signup" element={<SignupWizard />} />
        <Route path="/profile" element={<ProfileSettings />} />
        <Route path="/comment" element={<CommentEditor />} />
        <Route path="/done" element={<p>Submitted!</p>} />
      </Routes>
    </BrowserRouter>
  );
}
