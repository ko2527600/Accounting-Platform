import { useState, useRef, useEffect, useCallback } from "react";
import { useTheme } from "../../contexts/ThemeContext";
import { useAuth } from "../../contexts/AuthContext";
import { Sun, Moon, Bell, Search, User, LogOut, Settings as SettingsIcon, CheckCheck, AlertTriangle, ArrowRightLeft, FileText, Landmark } from "lucide-react";
import { Input } from "../ui/Input";
import { Button } from "../ui/Button";
import { useNavigate } from "react-router-dom";
import { api } from "../../lib/api";

interface AppNotification {
  id: string;
  title: string;
  message: string;
  type: string;
  read: boolean;
  link?: string;
  createdAt: string;
}

export function Header() {
  const { theme, setTheme } = useTheme();
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showProfile, setShowProfile] = useState(false);

  const notifRef = useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await api.get("/notifications");
      if (res.data.success) {
        setNotifications(res.data.data.notifications);
        setUnreadCount(res.data.data.unreadCount);
      }
    } catch (err) {
      console.error("Failed to fetch notifications:", err);
    }
  }, []);

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 15000); // Polling every 15s for live notifications
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (notifRef.current && !notifRef.current.contains(event.target as Node)) {
        setShowNotifications(false);
      }
      if (profileRef.current && !profileRef.current.contains(event.target as Node)) {
        setShowProfile(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleMarkAllRead = async () => {
    try {
      const res = await api.put("/notifications/read-all");
      if (res.data.success) {
        setNotifications(prev => prev.map(n => ({ ...n, read: true })));
        setUnreadCount(0);
      }
    } catch (err) {
      console.error("Failed to mark notifications as read:", err);
    }
  };

  const handleNotificationClick = async (notif: AppNotification) => {
    if (!notif.read) {
      try {
        await api.put(`/notifications/${notif.id}/read`);
        setUnreadCount(prev => Math.max(0, prev - 1));
        setNotifications(prev => prev.map(n => n.id === notif.id ? { ...n, read: true } : n));
      } catch (err) {
        console.error("Error marking single notification read:", err);
      }
    }
    setShowNotifications(false);
    if (notif.link) navigate(notif.link);
  };

  const triggerCommandMenu = () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }));
  };

  const getNotifIcon = (type: string) => {
    switch (type) {
      case "DISCREPANCY":
        return <AlertTriangle className="h-4 w-4 text-rose-500 flex-shrink-0" />;
      case "TILL_CLOSEOUT":
        return <Landmark className="h-4 w-4 text-emerald-500 flex-shrink-0" />;
      case "TRANSFER_REQUEST":
        return <ArrowRightLeft className="h-4 w-4 text-amber-500 flex-shrink-0" />;
      case "INVOICE_PAID":
        return <FileText className="h-4 w-4 text-blue-500 flex-shrink-0" />;
      default:
        return <Bell className="h-4 w-4 text-primary-500 flex-shrink-0" />;
    }
  };

  return (
    <header className="h-16 flex items-center justify-between px-6 bg-white dark:bg-secondary-900 border-b border-secondary-200 dark:border-secondary-800 transition-colors duration-200 z-10 relative">
      <div className="flex flex-1 items-center space-x-4">
        {/* Global Search */}
        <div className="max-w-md w-full relative group cursor-text" onClick={triggerCommandMenu}>
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-secondary-400 group-focus-within:text-primary-500 transition-colors" />
          <Input
            type="text"
            readOnly
            placeholder="Search accounts, entries, reports... (Cmd+K)"
            className="pl-9 bg-secondary-50 dark:bg-secondary-800/50 border-transparent focus:border-primary-500 focus:bg-white dark:focus:bg-secondary-900 transition-all shadow-none cursor-pointer"
          />
        </div>
      </div>

      <div className="flex items-center space-x-4">
        {/* Theme Toggle */}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          className="rounded-full"
          aria-label="Toggle theme"
        >
          <Sun className="h-5 w-5 transition-all dark:-rotate-90 dark:scale-0" />
          <Moon className="absolute h-5 w-5 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
        </Button>

        {/* Notifications Dropdown */}
        <div className="relative" ref={notifRef}>
          <Button 
            variant="ghost" 
            size="icon" 
            className="relative rounded-full"
            onClick={() => setShowNotifications(!showNotifications)}
          >
            <Bell className="h-5 w-5 text-secondary-600 dark:text-secondary-300" />
            {unreadCount > 0 && (
              <span className="absolute top-1.5 right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white shadow-sm animate-pulse">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </Button>
          
          {showNotifications && (
            <div className="absolute right-0 mt-2 w-80 md:w-96 bg-white dark:bg-secondary-900 rounded-xl shadow-xl border border-secondary-200 dark:border-secondary-800 z-50 overflow-hidden animate-in slide-in-from-top-2">
              <div className="px-4 py-3 border-b border-secondary-200 dark:border-secondary-800 flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <h3 className="text-sm font-semibold text-secondary-900 dark:text-secondary-50">Notifications</h3>
                  {unreadCount > 0 && (
                    <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-primary-100 dark:bg-primary-900/40 text-primary-700 dark:text-primary-300">
                      {unreadCount} unread
                    </span>
                  )}
                </div>
                {unreadCount > 0 && (
                  <button
                    onClick={handleMarkAllRead}
                    className="text-xs font-medium text-primary-600 hover:text-primary-500 dark:text-primary-400 flex items-center"
                  >
                    <CheckCheck className="h-3.5 w-3.5 mr-1" />
                    Mark all read
                  </button>
                )}
              </div>

              <div className="max-h-96 overflow-y-auto divide-y divide-secondary-100 dark:divide-secondary-800">
                {notifications.length === 0 ? (
                  <div className="px-4 py-8 text-center text-xs text-secondary-400">
                    No notifications yet.
                  </div>
                ) : (
                  notifications.map((notif) => (
                    <div
                      key={notif.id}
                      onClick={() => handleNotificationClick(notif)}
                      className={`px-4 py-3 hover:bg-secondary-50 dark:hover:bg-secondary-800/50 cursor-pointer transition-colors flex items-start space-x-3 ${
                        !notif.read ? 'bg-primary-50/40 dark:bg-primary-950/20' : ''
                      }`}
                    >
                      {getNotifIcon(notif.type)}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <p className={`text-xs font-semibold ${!notif.read ? 'text-secondary-900 dark:text-secondary-50' : 'text-secondary-600 dark:text-secondary-400'}`}>
                            {notif.title}
                          </p>
                          {!notif.read && (
                            <span className="h-2 w-2 rounded-full bg-primary-600 flex-shrink-0 ml-2" />
                          )}
                        </div>
                        <p className="text-xs text-secondary-500 dark:text-secondary-400 mt-0.5 line-clamp-2">
                          {notif.message}
                        </p>
                        <span className="text-[10px] text-secondary-400 mt-1 block">
                          {new Date(notif.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        <div className="h-8 w-px bg-secondary-200 dark:bg-secondary-800 mx-2"></div>

        {/* User Profile */}
        <div className="relative" ref={profileRef}>
          <div 
            className="flex items-center space-x-3 cursor-pointer p-1 pr-2 rounded-full hover:bg-secondary-100 dark:hover:bg-secondary-800 transition-colors"
            onClick={() => setShowProfile(!showProfile)}
          >
            <div className="h-8 w-8 rounded-full bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center text-primary-700 dark:text-primary-400">
              <User className="h-4 w-4" />
            </div>
            <span className="text-sm font-medium text-secondary-700 dark:text-secondary-300 hidden sm:block">
              {user?.name || "Admin"}
            </span>
          </div>

          {showProfile && (
            <div className="absolute right-0 mt-2 w-48 bg-white dark:bg-secondary-900 rounded-lg shadow-lg border border-secondary-200 dark:border-secondary-800 z-50 overflow-hidden animate-in slide-in-from-top-2">
              <div className="px-4 py-3 border-b border-secondary-200 dark:border-secondary-800">
                <p className="text-sm font-medium text-secondary-900 dark:text-secondary-50">{user?.name || "Admin User"}</p>
                <p className="text-xs text-secondary-500 truncate">{user?.email || "admin@accountgo.com"}</p>
              </div>
              <div className="py-1">
                <button 
                  onClick={() => { setShowProfile(false); navigate("/settings"); }}
                  className="w-full flex items-center px-4 py-2 text-sm text-secondary-700 dark:text-secondary-300 hover:bg-secondary-50 dark:hover:bg-secondary-800 transition-colors"
                >
                  <SettingsIcon className="mr-2 h-4 w-4" />
                  Preferences
                </button>
                <button 
                  onClick={() => { 
                    setShowProfile(false); 
                    logout();
                    navigate("/login"); 
                  }}
                  className="w-full flex items-center px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  Sign out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
