import { Switch, Route } from "wouter";
import Home from "@/pages/Home";
import Dashboard from "@/pages/Dashboard";

function App() {
  return (
    <Switch>
      <Route path="/dashboard" component={Dashboard} />
      <Route component={Home} />
    </Switch>
  );
}

export default App;
