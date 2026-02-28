import { Switch, Route, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Dashboard from "@/pages/dashboard";
import Monitor from "@/pages/monitor";
import Admin from "@/pages/admin";
import Register from "@/pages/register";
import Login from "@/pages/login";
import Convert from "@/pages/convert";
import Activity from "@/pages/activity";
import Profile from "@/pages/profile";
import TransparencyPage from "@/pages/transparency";
import NotFound from "@/pages/not-found";
import { TransparencyDashboard } from "@/components/transparency-dashboard";

function Router() {
  return (
    <Switch>
      {/* Public transparency landing page */}
      <Route path="/" component={TransparencyDashboard} />

      {/* Auth */}
      <Route path="/register" component={Register} />
      <Route path="/login" component={Login} />

      {/* Main App - unified trade experience */}
      <Route path="/trade" component={Dashboard} />
      <Route path="/portfolio">
        <Redirect to="/trade" />
      </Route>
      <Route path="/convert" component={Convert} />
      <Route path="/activity" component={Activity} />
      <Route path="/profile" component={Profile} />
      <Route path="/transparency" component={TransparencyPage} />

      {/* Advanced monitoring (for power users/devs) */}
      <Route path="/monitor" component={Monitor} />
      <Route path="/monitor/admin" component={Admin} />

      {/* Legacy redirect */}
      <Route path="/trading" component={Dashboard} />

      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
