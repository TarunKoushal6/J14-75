import { Router, Route } from "wouter";
import Home from "./pages/Home";
import Dashboard from "./pages/Dashboard";

export default function App() {
  return (
    <Router base={import.meta.env.BASE_URL}>
      <Route path="/" component={Home} />
      <Route path="/dashboard" component={Dashboard} />
    </Router>
  );
}
