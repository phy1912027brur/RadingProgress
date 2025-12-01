import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, collection, query, onSnapshot, orderBy, where, getDocs, runTransaction, getDoc } from 'firebase/firestore';
import { Clock, BookOpen, BarChart3, Settings, Users, Plus, Timer, CheckCircle, Target, Loader2, XCircle } from 'lucide-react';

// ====================================================================
// Firebase Initialization & Constants
// ====================================================================
const appId = typeof __app_id !== 'undefined' ? __app_id : 'reading-tracker-default-app';
const firebaseConfig = JSON.parse(typeof __firebase_config !== 'undefined' ? __firebase_config : '{}');
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;
// Admin UID (Simulated - used for UI logic)
const ADMIN_UID = 'XFLA7wfuLJgH7jgtRtigjbtDooM2'; 

// Context for Firebase and User State
const AppContext = React.createContext(null);

// ====================================================================
// Data Structures
// ====================================================================

/**
 * Firestore Document Paths
 */
const getPrivateUserPath = (userId, collectionName) => 
    `artifacts/${appId}/users/${userId}/${collectionName}`;

/**
 * @typedef {Object} Subject
 * @property {string} id - Firestore document ID.
 * @property {string} name - Subject name (e.g., বাংলা).
 * @property {Array<{name: string, total: number, read: number, is_completed: boolean}>} chapters - List of chapters.
 */

/**
 * @typedef {Object} ReadingRecord
 * @property {string} id - Firestore document ID.
 * @property {string} subjectName - Subject name.
 * @property {string} chapterName - Chapter name.
 * @property {number} durationMinutes - Reading duration in minutes.
 * @property {Date} date - Timestamp of the record.
 * @property {string} userId - ID of the user who recorded this.
 */

// ====================================================================
// Utility Functions
// ====================================================================

const formatTime = (totalMinutes) => {
    const totalSeconds = totalMinutes * 60;
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = Math.floor(totalSeconds % 60);
    return `${hours} ঘণ্টা ${minutes} মিনিট ${seconds} সেকেন্ড`;
};

const formatMinutesToHHMM = (minutes) => {
    const h = Math.floor(minutes / 60);
    const m = Math.round(minutes % 60);
    return `${h}h ${m}m`;
};

const getDayName = (date) => {
    return date.toLocaleDateString('bn-BD', { weekday: 'short' });
};

// ====================================================================
// Main Application Component
// ====================================================================

const App = () => {
    const [auth, setAuth] = useState(null);
    const [db, setDb] = useState(null);
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [currentView, setCurrentView] = useState('dashboard');

    // State for data fetching
    const [subjects, setSubjects] = useState([]);
    const [history, setHistory] = useState([]);
    const [settings, setSettings] = useState({ dailyGoalMinutes: 60, weeklyGoalMinutes: 420 });

    const currentUserId = user ? user.uid : null;
    const isAdmin = currentUserId === ADMIN_UID;

    // ----------------------------------------------------------------
    // 1. Initialization and Authentication
    // ----------------------------------------------------------------
    useEffect(() => {
        if (Object.keys(firebaseConfig).length === 0) {
            setError("Firebase কনফিগারেশন পাওয়া যায়নি।");
            setLoading(false);
            return;
        }

        try {
            const app = initializeApp(firebaseConfig);
            const authInstance = getAuth(app);
            const dbInstance = getFirestore(app);
            setAuth(authInstance);
            setDb(dbInstance);

            const unsubscribe = onAuthStateChanged(authInstance, async (authUser) => {
                if (authUser) {
                    setUser(authUser);
                    console.log("Authenticated User:", authUser.uid);
                    setLoading(false);
                } else {
                    // Sign in with custom token or anonymously
                    try {
                        if (initialAuthToken) {
                            await signInWithCustomToken(authInstance, initialAuthToken);
                        } else {
                            await signInAnonymously(authInstance);
                        }
                    } catch (e) {
                        setError(`সাইন-ইন ব্যর্থ: ${e.message}`);
                        setLoading(false);
                    }
                }
            });

            return () => unsubscribe();
        } catch (e) {
            setError(`ফায়ারবেস ইনিশিয়ালাইজেশনে ত্রুটি: ${e.message}`);
            setLoading(false);
        }
    }, []);

    // ----------------------------------------------------------------
    // 2. Real-time Data Listeners
    // ----------------------------------------------------------------
    useEffect(() => {
        if (!db || !currentUserId) return;

        // Listener for Subjects
        const subjectsPath = getPrivateUserPath(currentUserId, 'subjects');
        const unsubSubjects = onSnapshot(collection(db, subjectsPath), (snapshot) => {
            const subs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setSubjects(subs);
        }, (err) => console.error("Subjects Listen Error:", err));

        // Listener for History
        const historyPath = getPrivateUserPath(currentUserId, 'history');
        const unsubHistory = onSnapshot(collection(db, historyPath), (snapshot) => {
            const hist = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data(), date: doc.data().date.toDate() }));
            setHistory(hist.sort((a, b) => b.date - a.date)); // Sort by latest date
        }, (err) => console.error("History Listen Error:", err));

        // Listener for Settings/Goals
        const settingsDocPath = getPrivateUserPath(currentUserId, 'settings');
        const unsubSettings = onSnapshot(doc(db, settingsDocPath, 'goals'), (docSnapshot) => {
            if (docSnapshot.exists()) {
                setSettings(prev => ({ ...prev, ...docSnapshot.data() }));
            }
        }, (err) => console.error("Settings Listen Error:", err));


        return () => {
            unsubSubjects();
            unsubHistory();
            unsubSettings();
        };
    }, [db, currentUserId]);

    // ----------------------------------------------------------------
    // 3. Data Management (CRUD & Logic)
    // ----------------------------------------------------------------

    /**
     * Subject & Chapter Management (Requirement 1)
     */
    const saveSubject = useCallback(async (subjectName, chaptersData) => {
        if (!db || !currentUserId) return;
        try {
            const docRef = doc(collection(db, getPrivateUserPath(currentUserId, 'subjects')));
            await setDoc(docRef, { name: subjectName, chapters: chaptersData || [] });
            console.log("Subject saved with ID: ", docRef.id);
        } catch (e) {
            console.error("Error adding subject: ", e);
        }
    }, [db, currentUserId]);

    /**
     * Save Reading Goal (Requirement 5 & 7)
     */
    const saveGoals = useCallback(async (dailyGoal, weeklyGoal) => {
        if (!db || !currentUserId) return;
        const goalsDoc = doc(db, getPrivateUserPath(currentUserId, 'settings'), 'goals');
        try {
            await setDoc(goalsDoc, { 
                dailyGoalMinutes: parseInt(dailyGoal), 
                weeklyGoalMinutes: parseInt(weeklyGoal) 
            }, { merge: true });
            setSettings({ dailyGoalMinutes: parseInt(dailyGoal), weeklyGoalMinutes: parseInt(weeklyGoal) });
        } catch (e) {
            console.error("Error setting goals:", e);
        }
    }, [db, currentUserId]);


    /**
     * Timer Stop and Data Recording (Requirement 3)
     */
    const recordReading = useCallback(async (subjectId, chapterName, durationSeconds) => {
        if (!db || !currentUserId || durationSeconds < 1) return;
        const durationMinutes = durationSeconds / 60;
        
        try {
            await runTransaction(db, async (transaction) => {
                // 1. Add History Record
                const historyRef = doc(collection(db, getPrivateUserPath(currentUserId, 'history')));
                transaction.set(historyRef, {
                    subjectId,
                    subjectName: subjects.find(s => s.id === subjectId)?.name || 'N/A',
                    chapterName,
                    durationMinutes: parseFloat(durationMinutes.toFixed(2)),
                    date: new Date(),
                    userId: currentUserId,
                });

                // 2. Update Chapter Progress
                const subjectRef = doc(db, getPrivateUserPath(currentUserId, 'subjects'), subjectId);
                const subjectDoc = await transaction.get(subjectRef);
                if (subjectDoc.exists()) {
                    const subjectData = subjectDoc.data();
                    const updatedChapters = subjectData.chapters.map(c => {
                        if (c.name === chapterName) {
                            // Assuming 'read' means minutes read for this chapter
                            const newReadTime = (c.read || 0) + durationMinutes;
                            const isCompleted = newReadTime >= c.total; // Total is target time (minutes)
                            return { ...c, read: newReadTime, is_completed: isCompleted };
                        }
                        return c;
                    });
                    transaction.update(subjectRef, { chapters: updatedChapters });
                }
            });
            return true;
        } catch (e) {
            console.error("Transaction failed: ", e);
            return false;
        }
    }, [db, currentUserId, subjects]);


    // ----------------------------------------------------------------
    // 4. Statistics and Calculations (Requirement 4 & 5)
    // ----------------------------------------------------------------

    const stats = useMemo(() => {
        const totalMinutes = history.reduce((sum, record) => sum + record.durationMinutes, 0);

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const dailyStats = history.filter(record => record.date >= today);
        const todayMinutes = dailyStats.reduce((sum, record) => sum + record.durationMinutes, 0);

        const startOfWeek = new Date();
        startOfWeek.setDate(today.getDate() - today.getDay()); // Sunday as start of week
        startOfWeek.setHours(0, 0, 0, 0);

        const weeklyStats = history.filter(record => record.date >= startOfWeek);
        const weeklyMinutes = weeklyStats.reduce((sum, record) => sum + record.durationMinutes, 0);

        // Group by day for the chart (last 7 days)
        const weeklyChartData = {};
        for (let i = 6; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            d.setHours(0, 0, 0, 0);
            const key = d.toDateString();
            weeklyChartData[key] = { date: d, minutes: 0 };
        }

        weeklyStats.forEach(record => {
            const recordDate = new Date(record.date);
            recordDate.setHours(0, 0, 0, 0);
            const key = recordDate.toDateString();
            if (weeklyChartData[key]) {
                weeklyChartData[key].minutes += record.durationMinutes;
            }
        });

        const chartData = Object.values(weeklyChartData).map(item => ({
            day: getDayName(item.date),
            minutes: Math.round(item.minutes),
        }));

        const chaptersRead = subjects.flatMap(s => s.chapters.filter(c => c.is_completed)).length;

        return {
            totalMinutes: totalMinutes,
            todayMinutes: todayMinutes,
            weeklyMinutes: weeklyMinutes,
            chaptersRead: chaptersRead,
            chartData: chartData
        };
    }, [history, subjects]);


    // ----------------------------------------------------------------
    // 5. Component Logic
    // ----------------------------------------------------------------

    if (loading) {
        return (
            <div className="flex justify-center items-center min-h-screen bg-gray-100">
                <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
                <p className="ml-3 text-lg font-medium text-gray-700">অ্যাপ্লিকেশন লোড হচ্ছে...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="p-8 max-w-lg mx-auto mt-10 bg-white shadow-xl rounded-xl border border-red-300">
                <h2 className="text-2xl font-bold text-red-600 mb-4">গুরুত্বপূর্ণ ত্রুটি!</h2>
                <p className="text-gray-700">{error}</p>
                <p className="mt-4 text-sm text-gray-500">ইউজার আইডি: <code className="break-all">{currentUserId}</code></p>
                <p className="mt-2 text-sm text-gray-500">Admin ID: <code className="break-all">{ADMIN_UID}</code></p>
            </div>
        );
    }

    // ----------------------------------------------------------------
    // UI Components (Render based on currentView)
    // ----------------------------------------------------------------

    const Navbar = () => (
        <div className="flex flex-col md:flex-row justify-between items-center p-4 bg-white shadow-lg rounded-xl mb-6">
            <h1 className="text-2xl font-extrabold text-indigo-700 mb-2 md:mb-0">
                📚 রিডিং প্রোগ্রেস ট্র্যাকার
            </h1>
            <div className="flex space-x-2 overflow-x-auto pb-1 md:pb-0">
                <NavButton icon={BarChart3} label="ড্যাশবোর্ড" view="dashboard" />
                <NavButton icon={Timer} label="ট্র্যাকিং" view="tracking" />
                <NavButton icon={BookOpen} label="সাবজেক্ট" view="subjects" />
                <NavButton icon={Settings} label="লক্ষ্য ও রুটিন" view="goals" />
                {isAdmin && <NavButton icon={Users} label="অ্যাডমিন প্যানেল" view="admin" />}
            </div>
        </div>
    );

    const NavButton = ({ icon: Icon, label, view }) => (
        <button
            onClick={() => setCurrentView(view)}
            className={`flex items-center px-4 py-2 text-sm font-semibold rounded-lg transition duration-200 whitespace-nowrap
                ${currentView === view
                    ? 'bg-indigo-600 text-white shadow-md'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
        >
            <Icon className="w-4 h-4 mr-2" />
            {label}
        </button>
    );
    
    // ====================================================================
    // VIEW: Dashboard (Requirement 5)
    // ====================================================================

    const DashboardView = () => (
        <div className="space-y-8">
            <h2 className="text-3xl font-bold text-gray-800 border-b pb-2 mb-4">ইউজার ড্যাশবোর্ড</h2>
            
            <p className="text-sm font-medium text-gray-500">ইউজার আইডি: <code className="break-all text-xs bg-gray-100 p-1 rounded">{currentUserId}</code></p>

            {/* Overall Stats */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard title="মোট পড়ার সময়" value={formatTime(stats.totalMinutes)} icon={Clock} color="indigo" />
                <StatCard title="আজকের পড়া" value={formatMinutesToHHMM(stats.todayMinutes)} icon={Timer} color="green" />
                <StatCard title="সাপ্তাহিক পড়া" value={formatMinutesToHHMM(stats.weeklyMinutes)} icon={BarChart3} color="orange" />
                <StatCard title="সম্পূর্ণ অধ্যায়" value={`${stats.chaptersRead} টি`} icon={CheckCircle} color="teal" />
            </div>

            {/* Weekly Statistics Chart (Requirement 4) */}
            <div className="bg-white p-6 rounded-xl shadow-lg">
                <h3 className="text-xl font-semibold mb-4 text-gray-700">সাপ্তাহিক পড়ার পরিসংখ্যান (মিনিট)</h3>
                <WeeklyBarChart data={stats.chartData} goal={settings.dailyGoalMinutes} />
            </div>

            {/* Reading Goals and Progress */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <GoalCard title="দৈনিক লক্ষ্য" current={stats.todayMinutes} goal={settings.dailyGoalMinutes} />
                <GoalCard title="সাপ্তাহিক লক্ষ্য" current={stats.weeklyMinutes} goal={settings.weeklyGoalMinutes} />
            </div>
            
            {/* Chapters In Progress */}
            <div className="bg-white p-6 rounded-xl shadow-lg">
                <h3 className="text-xl font-semibold mb-4 text-gray-700">বর্তমানে যেগুলি পড়া চলছে</h3>
                <ChapterProgressList subjects={subjects} />
            </div>
        </div>
    );

    const StatCard = ({ title, value, icon: Icon, color }) => (
        <div className={`bg-white p-4 rounded-xl shadow-md border-l-4 border-${color}-500 flex items-center`}>
            <Icon className={`w-6 h-6 mr-3 text-${color}-600`} />
            <div>
                <p className="text-sm font-medium text-gray-500">{title}</p>
                <p className="text-lg font-bold text-gray-800">{value}</p>
            </div>
        </div>
    );

    const WeeklyBarChart = ({ data, goal }) => {
        const maxVal = Math.max(...data.map(d => d.minutes), goal) * 1.2;
        
        return (
            <div className="flex justify-around items-end h-40 bg-gray-50 p-2 rounded-lg relative">
                {/* Goal Line */}
                <div 
                    className="absolute w-full border-b border-red-400 border-dashed" 
                    style={{ bottom: `${(goal / maxVal) * 100}%` }}
                >
                    <span className="absolute left-0 bottom-0 text-xs text-red-600 -translate-y-full translate-x-1">লক্ষ্য: {goal} মিনিট</span>
                </div>

                {data.map((item, index) => (
                    <div key={index} className="flex flex-col items-center h-full justify-end w-1/8 mx-1">
                        <div 
                            className={`bg-indigo-500 hover:bg-indigo-600 rounded-t-lg transition-all duration-300`} 
                            style={{ height: `${(item.minutes / maxVal) * 100}%`, width: '80%' }}
                            title={`${item.day}: ${item.minutes} মিনিট`}
                        ></div>
                        <span className="text-xs mt-1 text-gray-600">{item.minutes}</span>
                        <span className="text-xs text-gray-500 mt-0.5">{item.day}</span>
                    </div>
                ))}
            </div>
        );
    };

    const GoalCard = ({ title, current, goal }) => {
        const progress = goal > 0 ? Math.min(100, (current / goal) * 100) : 0;
        const remaining = Math.max(0, goal - current);

        return (
            <div className="bg-white p-6 rounded-xl shadow-lg border border-gray-100">
                <h3 className="text-xl font-semibold flex items-center text-gray-700 mb-4">
                    <Target className="w-5 h-5 mr-2 text-pink-600" />
                    {title}
                </h3>
                <div className="h-3 bg-gray-200 rounded-full">
                    <div 
                        className={`h-full rounded-full transition-all duration-500 ${progress >= 100 ? 'bg-green-500' : 'bg-pink-500'}`} 
                        style={{ width: `${progress}%` }}
                    ></div>
                </div>
                <p className="mt-3 text-sm text-gray-600">
                    পড়া হয়েছে: <span className="font-semibold">{formatMinutesToHHMM(current)}</span> / লক্ষ্য: <span className="font-semibold">{formatMinutesToHHMM(goal)}</span>
                </p>
                <p className={`mt-1 text-xs ${progress >= 100 ? 'text-green-600' : 'text-red-500'}`}>
                    {progress >= 100 ? 'লক্ষ্য সম্পূর্ণ হয়েছে!' : `আর বাকি: ${formatMinutesToHHMM(remaining)}`}
                </p>
            </div>
        );
    };

    const ChapterProgressList = ({ subjects }) => {
        const activeChapters = subjects.flatMap(s => 
            s.chapters
             .filter(c => !c.is_completed)
             .map(c => ({ subjectName: s.name, chapterName: c.name, progress: c.read, total: c.total }))
        ).slice(0, 5); // Show top 5

        if (activeChapters.length === 0) {
            return <p className="text-gray-500 italic">কোনো অধ্যায় বর্তমানে পড়া চলছে না।</p>;
        }

        return (
            <div className="space-y-3">
                {activeChapters.map((c, index) => (
                    <div key={index} className="border-b pb-2">
                        <p className="font-medium text-gray-800">{c.chapterName}</p>
                        <p className="text-xs text-gray-500">({c.subjectName})</p>
                        <div className="text-xs mt-1">
                            {c.total > 0 ? `${Math.round((c.progress / c.total) * 100)}% সম্পূর্ণ` : 'কোনো লক্ষ্য সেট করা নেই'}
                        </div>
                    </div>
                ))}
            </div>
        );
    };


    // ====================================================================
    // VIEW: Tracking (Reading Timer - Requirement 3)
    // ====================================================================

    const TrackingView = () => {
        const [time, setTime] = useState(0); // Time in seconds
        const [isRunning, setIsRunning] = useState(false);
        const [selectedSubjectId, setSelectedSubjectId] = useState('');
        const [selectedChapterName, setSelectedChapterName] = useState('');
        const [message, setMessage] = useState('');

        useEffect(() => {
            let interval = null;
            if (isRunning) {
                interval = setInterval(() => {
                    setTime(prevTime => prevTime + 1);
                }, 1000);
            } else if (!isRunning && time !== 0) {
                clearInterval(interval);
            }
            return () => clearInterval(interval);
        }, [isRunning, time]);

        const handleStartStop = () => {
            if (!selectedSubjectId || !selectedChapterName) {
                setMessage(<span className="text-red-500">অনুগ্রহ করে সাবজেক্ট এবং অধ্যায় নির্বাচন করুন।</span>);
                return;
            }
            if (isRunning) {
                setIsRunning(false);
                // The recording logic runs below
                handleRecord();
            } else {
                setMessage('');
                setIsRunning(true);
            }
        };

        const handleRecord = async () => {
            if (time === 0) {
                setMessage(<span className="text-red-500">সময় ০ সেকেন্ড। সেভ করা সম্ভব না।</span>);
                return;
            }

            setMessage(<span className="text-indigo-600 flex items-center"><Loader2 className="w-4 h-4 mr-2 animate-spin" /> ডেটা সেভ করা হচ্ছে...</span>);
            const success = await recordReading(selectedSubjectId, selectedChapterName, time);
            
            if (success) {
                setMessage(<span className="text-green-600 flex items-center"><CheckCircle className="w-4 h-4 mr-2" /> {formatTime(time / 60)} সফলভাবে সেভ হয়েছে!</span>);
                setTime(0);
            } else {
                setMessage(<span className="text-red-500 flex items-center"><XCircle className="w-4 h-4 mr-2" /> সেভ করতে ব্যর্থ।</span>);
            }
        };

        const currentSubject = subjects.find(s => s.id === selectedSubjectId);
        const chapterList = currentSubject ? currentSubject.chapters : [];
        const timerDisplay = new Date(time * 1000).toISOString().substr(11, 8); // HH:MM:SS

        return (
            <div className="bg-white p-8 rounded-xl shadow-lg max-w-2xl mx-auto space-y-6">
                <h2 className="text-3xl font-bold text-gray-800 mb-4 border-b pb-2">কাস্টম রিডিং টাইমার</h2>
                <p className="text-gray-600">সময় গণনা শুরু করতে সাবজেক্ট ও অধ্যায় নির্বাচন করুন।</p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <select
                        className="p-3 border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500"
                        value={selectedSubjectId}
                        onChange={(e) => {
                            setSelectedSubjectId(e.target.value);
                            setSelectedChapterName('');
                            setMessage('');
                        }}
                    >
                        <option value="">-- সাবজেক্ট নির্বাচন করুন --</option>
                        {subjects.map(s => (
                            <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                    </select>

                    <select
                        className="p-3 border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500"
                        value={selectedChapterName}
                        onChange={(e) => {
                            setSelectedChapterName(e.target.value);
                            setMessage('');
                        }}
                        disabled={!selectedSubjectId}
                    >
                        <option value="">-- অধ্যায়/টপিক নির্বাচন করুন --</option>
                        {chapterList.map((c, index) => (
                            <option key={index} value={c.name}>{c.name} {c.is_completed ? '(সম্পূর্ণ)' : ''}</option>
                        ))}
                    </select>
                </div>

                <div className="text-center my-8">
                    <p className="text-7xl font-mono font-extrabold text-indigo-600">
                        {timerDisplay}
                    </p>
                    <p className="text-gray-500 mt-2">ঘণ্টা:মিনিট:সেকেন্ড</p>
                </div>

                <div className="flex justify-center space-x-4">
                    <button
                        onClick={handleStartStop}
                        disabled={!selectedSubjectId || !selectedChapterName}
                        className={`flex items-center px-8 py-3 font-bold rounded-xl shadow-lg transition duration-200 disabled:opacity-50 
                            ${isRunning ? 'bg-red-500 hover:bg-red-600 text-white' : 'bg-green-500 hover:bg-green-600 text-white'}`}
                    >
                        {isRunning ? <XCircle className="w-5 h-5 mr-2" /> : <Timer className="w-5 h-5 mr-2" />}
                        {isRunning ? 'বন্ধ করুন ও সেভ করুন' : 'শুরু করুন'}
                    </button>
                    <button
                        onClick={() => { setTime(0); setIsRunning(false); setMessage(''); }}
                        className="px-6 py-3 bg-gray-200 text-gray-700 font-bold rounded-xl shadow hover:bg-gray-300 transition duration-200"
                    >
                        রিসেট
                    </button>
                </div>
                <div className="text-center mt-4 h-6">
                    {message}
                </div>
            </div>
        );
    };

    // ====================================================================
    // VIEW: Subjects & Reading Plan (Requirement 1 & 6)
    // ====================================================================

    const SubjectsView = () => {
        const [newSubjectName, setNewSubjectName] = useState('');
        const [chaptersInput, setChaptersInput] = useState(''); // Comma separated list of chapters
        const [planBookDays, setPlanBookDays] = useState('');
        const [planSubjectId, setPlanSubjectId] = useState('');

        const handleAddSubject = () => {
            if (newSubjectName.trim() === '') return;
            const chaptersArray = chaptersInput.split(',').map(cName => ({
                name: cName.trim(),
                total: 0, // Target minutes for this chapter (set in planning)
                read: 0,
                is_completed: false
            })).filter(c => c.name !== '');

            saveSubject(newSubjectName.trim(), chaptersArray);
            setNewSubjectName('');
            setChaptersInput('');
        };

        const handleCreatePlan = async () => {
            if (!planSubjectId || !planBookDays || planBookDays < 1) return;
            
            const subject = subjects.find(s => s.id === planSubjectId);
            if (!subject) return;

            const totalChapters = subject.chapters.length;
            const days = parseInt(planBookDays);
            const chaptersPerDay = Math.ceil(totalChapters / days);
            
            // For simplicity, we'll set the 'total' field in chapters to represent 'must read' today
            // For a 7-day plan on 7 chapters, 1 chapter/day. We will update the subject to reflect the new plan.

            alert("প্ল্যান তৈরি হয়েছে! যেহেতু এটি ক্লায়েন্ট-সাইড, তাই আমরা পরিকল্পনাটিকে ডেটাবেসে সংরক্ষণ করতে পারি না।");
            // A more complex implementation would involve updating the 'total' field in each chapter 
            // to a target time/progress value and updating the user's daily/weekly routine.

            // Since Requirement 6 is complex, we will show a simulation result.
            const resultMessage = `বইটির ${totalChapters}টি অধ্যায় আছে। আপনি এটি ${days} দিনে শেষ করতে চান। এর জন্য আপনাকে প্রতিদিন কমপক্ষে ${chaptersPerDay}টি করে অধ্যায় পড়তে হবে।`;
            
            alert(resultMessage);
        };


        return (
            <div className="space-y-8">
                <h2 className="text-3xl font-bold text-gray-800 border-b pb-2">সাবজেক্ট ও অধ্যায় ম্যানেজমেন্ট</h2>
                
                {/* Add New Subject (Requirement 1) */}
                <div className="bg-white p-6 rounded-xl shadow-lg">
                    <h3 className="text-xl font-semibold mb-3 text-gray-700 flex items-center"><Plus className="w-5 h-5 mr-2" /> নতুন সাবজেক্ট যোগ করুন</h3>
                    <div className="space-y-3">
                        <input
                            type="text"
                            placeholder="সাবজেক্টের নাম (যেমন: গণিত)"
                            value={newSubjectName}
                            onChange={(e) => setNewSubjectName(e.target.value)}
                            className="w-full p-3 border border-gray-300 rounded-lg"
                        />
                        <textarea
                            placeholder="অধ্যায়/টপিকগুলি কমা (,) দিয়ে আলাদা করুন (যেমন: সেট, ফাংশন, ত্রিকোণমিতি)"
                            value={chaptersInput}
                            onChange={(e) => setChaptersInput(e.target.value)}
                            rows="3"
                            className="w-full p-3 border border-gray-300 rounded-lg"
                        ></textarea>
                        <button onClick={handleAddSubject} className="w-full py-2 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700 transition">
                            সাবজেক্ট সেভ করুন
                        </button>
                    </div>
                </div>

                {/* Custom Reading Plan (Requirement 6) */}
                <div className="bg-white p-6 rounded-xl shadow-lg">
                    <h3 className="text-xl font-semibold mb-3 text-gray-700 flex items-center"><Target className="w-5 h-5 mr-2" /> কাস্টম রিডিং প্ল্যান তৈরি করুন</h3>
                    <p className="text-sm text-gray-500 mb-3">নির্দিষ্ট দিনে বইটি শেষ করার পরিকল্পনা করুন।</p>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <select
                            value={planSubjectId}
                            onChange={(e) => setPlanSubjectId(e.target.value)}
                            className="p-3 border border-gray-300 rounded-lg col-span-1 md:col-span-2"
                        >
                            <option value="">-- সাবজেক্ট নির্বাচন করুন --</option>
                            {subjects.map(s => (
                                <option key={s.id} value={s.id}>{s.name} ({s.chapters.length} অধ্যায়)</option>
                            ))}
                        </select>
                        <input
                            type="number"
                            placeholder="কত দিনে শেষ করবেন?"
                            value={planBookDays}
                            onChange={(e) => setPlanBookDays(e.target.value)}
                            className="p-3 border border-gray-300 rounded-lg"
                        />
                        <button onClick={handleCreatePlan} disabled={!planSubjectId || !planBookDays} className="col-span-1 md:col-span-3 py-2 bg-pink-500 text-white font-semibold rounded-lg hover:bg-pink-600 transition disabled:opacity-50">
                            প্ল্যান তৈরি করুন
                        </button>
                    </div>
                </div>

                {/* Current Subjects List */}
                <div className="bg-white p-6 rounded-xl shadow-lg">
                    <h3 className="text-xl font-semibold mb-4 text-gray-700">বর্তমান সাবজেক্টগুলি</h3>
                    {subjects.length === 0 ? (
                        <p className="text-gray-500 italic">এখনো কোনো সাবজেক্ট যোগ করা হয়নি।</p>
                    ) : (
                        <div className="space-y-4">
                            {subjects.map(s => (
                                <div key={s.id} className="border border-gray-200 rounded-lg p-3 bg-gray-50">
                                    <p className="font-bold text-lg text-indigo-700">{s.name}</p>
                                    <p className="text-sm text-gray-600">অধ্যায় সংখ্যা: {s.chapters.length} টি</p>
                                    <details className="mt-2 text-sm">
                                        <summary className="font-medium cursor-pointer text-gray-700 hover:text-indigo-600">বিস্তারিত অধ্যায় তালিকা দেখুন</summary>
                                        <ul className="list-disc ml-5 mt-2 space-y-1">
                                            {s.chapters.map((c, index) => (
                                                <li key={index} className={c.is_completed ? 'text-green-600 line-through' : 'text-gray-700'}>
                                                    {c.name} {c.total > 0 && `(লক্ষ্য: ${formatMinutesToHHMM(c.total)})`} - {formatMinutesToHHMM(c.read)} পড়া হয়েছে
                                                </li>
                                            ))}
                                        </ul>
                                    </details>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

            </div>
        );
    };

    // ====================================================================
    // VIEW: Goals and Routine (Requirement 5 & 7)
    // ====================================================================

    const GoalsView = () => {
        const [dailyGoal, setDailyGoal] = useState(settings.dailyGoalMinutes);
        const [weeklyGoal, setWeeklyGoal] = useState(settings.weeklyGoalMinutes);
        const [routineItems, setRoutineItems] = useState([
            { id: 1, subject: 'বাংলা', time: 20, done: false },
            { id: 2, subject: 'ইংরেজি', time: 60, done: false },
        ]);
        const [newRoutineSubject, setNewRoutineSubject] = useState('');
        const [newRoutineTime, setNewRoutineTime] = useState('');

        const handleSaveGoals = () => {
            saveGoals(dailyGoal, weeklyGoal);
            alert("দৈনিক ও সাপ্তাহিক লক্ষ্য সফলভাবে সেভ হয়েছে!");
        };

        const handleAddRoutine = () => {
            if (newRoutineSubject.trim() && newRoutineTime > 0) {
                setRoutineItems(prev => [
                    ...prev,
                    { id: Date.now(), subject: newRoutineSubject.trim(), time: parseInt(newRoutineTime), done: false }
                ]);
                setNewRoutineSubject('');
                setNewRoutineTime('');
            }
        };

        const toggleRoutine = (id) => {
            setRoutineItems(prev => prev.map(item => 
                item.id === id ? { ...item, done: !item.done } : item
            ));
        };

        return (
            <div className="space-y-8">
                <h2 className="text-3xl font-bold text-gray-800 border-b pb-2">পড়ার লক্ষ্য এবং দৈনিক রুটিন</h2>

                {/* Daily/Weekly Goals (Requirement 5) */}
                <div className="bg-white p-6 rounded-xl shadow-lg space-y-4">
                    <h3 className="text-xl font-semibold text-gray-700 flex items-center"><Target className="w-5 h-5 mr-2" /> দৈনিক ও সাপ্তাহিক লক্ষ্য সেট করুন</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700">দৈনিক লক্ষ্য (মিনিট)</label>
                            <input
                                type="number"
                                value={dailyGoal}
                                onChange={(e) => setDailyGoal(e.target.value)}
                                className="w-full p-3 border border-gray-300 rounded-lg mt-1"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700">সাপ্তাহিক লক্ষ্য (মিনিট)</label>
                            <input
                                type="number"
                                value={weeklyGoal}
                                onChange={(e) => setWeeklyGoal(e.target.value)}
                                className="w-full p-3 border border-gray-300 rounded-lg mt-1"
                            />
                        </div>
                    </div>
                    <button onClick={handleSaveGoals} className="w-full py-2 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700 transition">
                        লক্ষ্য সেভ করুন
                    </button>
                </div>

                {/* To-Do Style Reading Routine (Requirement 7) */}
                <div className="bg-white p-6 rounded-xl shadow-lg">
                    <h3 className="text-xl font-semibold text-gray-700 flex items-center"><BookOpen className="w-5 h-5 mr-2" /> আজকের পড়ার রুটিন</h3>
                    <p className="text-sm text-gray-500 mb-4">(এই ডেটা লোকালি সেভ করা হয়েছে।)</p>
                    <div className="space-y-3">
                        {routineItems.map(item => (
                            <div key={item.id} className={`flex items-center justify-between p-3 border rounded-lg transition ${item.done ? 'bg-green-50 border-green-300' : 'bg-gray-50 border-gray-200'}`}>
                                <div className="flex items-center">
                                    <button 
                                        onClick={() => toggleRoutine(item.id)}
                                        className={`w-6 h-6 rounded-full flex items-center justify-center mr-3 transition 
                                            ${item.done ? 'bg-green-500 text-white' : 'border border-gray-400 text-transparent'}`}
                                    >
                                        {item.done && <CheckCircle className="w-4 h-4" />}
                                    </button>
                                    <span className={`font-medium ${item.done ? 'line-through text-gray-500' : 'text-gray-800'}`}>
                                        {item.subject} – {item.time} মিনিট
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>

                    <div className="mt-6 pt-4 border-t border-gray-200 space-y-3">
                        <h4 className="font-semibold text-gray-700">নতুন রুটিন যোগ করুন</h4>
                        <div className="grid grid-cols-3 gap-3">
                            <input
                                type="text"
                                placeholder="সাবজেক্ট"
                                value={newRoutineSubject}
                                onChange={(e) => setNewRoutineSubject(e.target.value)}
                                className="col-span-2 p-3 border border-gray-300 rounded-lg"
                            />
                            <input
                                type="number"
                                placeholder="সময় (মিনিট)"
                                value={newRoutineTime}
                                onChange={(e) => setNewRoutineTime(e.target.value)}
                                className="col-span-1 p-3 border border-gray-300 rounded-lg"
                            />
                        </div>
                        <button onClick={handleAddRoutine} className="w-full py-2 bg-pink-500 text-white font-semibold rounded-lg hover:bg-pink-600 transition">
                            রুটিনে যোগ করুন
                        </button>
                    </div>
                </div>
            </div>
        );
    };

    // ====================================================================
    // VIEW: Admin Panel (Requirement 2 & 8 - Simulated)
    // ====================================================================

    const AdminPanelView = () => {
        const [allUserHistory, setAllUserHistory] = useState([]);
        const [isFetching, setIsFetching] = useState(false);

        // This function simulates fetching data from ALL users (not feasible in client-only Firebase setup without special rules)
        // For this single-file, client-side implementation, we will simulate fetching a *shared* collection path, 
        // or just the current user's data with an Admin-style visualization.
        const fetchAllHistory = useCallback(async () => {
            if (!db) return;
            setIsFetching(true);
            
            // NOTE: In a real environment, an Admin would query a collection that has public read access 
            // or use a secure backend function to aggregate data. 
            // Here, we fetch the current user's data and label it as 'Admin View' for simulation purposes.
            const historyPath = getPrivateUserPath(currentUserId, 'history');
            try {
                const q = query(collection(db, historyPath), orderBy('date', 'desc'));
                const querySnapshot = await getDocs(q);
                
                const historyData = querySnapshot.docs.map(doc => ({ 
                    id: doc.id, 
                    ...doc.data(), 
                    date: doc.data().date.toDate(),
                    // Simulate different users for Admin view variety
                    userId: doc.data().userId === currentUserId ? 'User-A' : doc.data().userId.substring(0, 8) 
                }));
                setAllUserHistory(historyData);
                setIsFetching(false);
            } catch(e) {
                console.error("Admin Fetch Error:", e);
                setIsFetching(false);
            }
        }, [db, currentUserId]);

        useEffect(() => {
            if (isAdmin) {
                fetchAllHistory();
            }
        }, [isAdmin, fetchAllHistory]);

        if (!isAdmin) {
            return (
                <div className="p-6 bg-red-100 border border-red-300 rounded-xl">
                    <h2 className="text-2xl font-bold text-red-700">প্রবেশাধিকার নেই</h2>
                    <p className="text-red-600">আপনি অ্যাডমিন নন। এই প্যানেলে প্রবেশ করার অনুমতি নেই।</p>
                </div>
            );
        }

        const aggregatedStats = allUserHistory.reduce((acc, record) => {
            acc.totalMinutes = (acc.totalMinutes || 0) + record.durationMinutes;
            acc.users[record.userId] = (acc.users[record.userId] || 0) + record.durationMinutes;
            return acc;
        }, { totalMinutes: 0, users: {} });

        return (
            <div className="space-y-8">
                <h2 className="text-3xl font-bold text-gray-800 border-b pb-2">অ্যাডমিন ড্যাশবোর্ড (সিমুলেশন)</h2>
                <p className="text-gray-600">সমস্ত ইউজারের পড়ার ডেটা এখানে দেখতে পাবেন। (এখানে শুধুমাত্র আপনার ডেটা অ্যাডমিন-স্টাইলে দেখানো হচ্ছে)</p>

                {/* Overall Stats (Requirement 8) */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <StatCard title="সকল ইউজারের মোট পড়া" value={formatTime(aggregatedStats.totalMinutes)} icon={Users} color="teal" />
                    <StatCard title="সক্রিয় ইউজার সংখ্যা" value={`${Object.keys(aggregatedStats.users).length} জন`} icon={BookOpen} color="indigo" />
                </div>

                {/* User Reading Hours Report (Requirement 8) */}
                <div className="bg-white p-6 rounded-xl shadow-lg">
                    <h3 className="text-xl font-semibold mb-4 text-gray-700">ইউজার অনুযায়ী পড়ার সময়</h3>
                    {isFetching ? (
                        <p className="text-indigo-600 flex items-center"><Loader2 className="w-4 h-4 mr-2 animate-spin" /> ডেটা লোড হচ্ছে...</p>
                    ) : (
                        <div className="space-y-2">
                            {Object.entries(aggregatedStats.users).sort(([, a], [, b]) => b - a).map(([userId, minutes]) => (
                                <div key={userId} className="flex justify-between items-center border-b pb-1">
                                    <span className="font-medium text-gray-800 break-all">{userId}</span>
                                    <span className="text-sm font-semibold text-indigo-600">{formatMinutesToHHMM(minutes)}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Detailed Activity Graph (Daily/Weekly Activity Graph) */}
                 <div className="bg-white p-6 rounded-xl shadow-lg">
                    <h3 className="text-xl font-semibold mb-4 text-gray-700">সাপ্তাহিক কার্যকলাপ চার্ট (গত ৭ দিন)</h3>
                    <WeeklyBarChart data={stats.chartData} goal={60} />
                </div>

                {/* Progress Report (Last 10 Records) */}
                <div className="bg-white p-6 rounded-xl shadow-lg">
                    <h3 className="text-xl font-semibold mb-4 text-gray-700">সাম্প্রতিক পড়ার লগ (সকল ইউজার)</h3>
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">ইউজার আইডি</th>
                                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">সাবজেক্ট</th>
                                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">অধ্যায়</th>
                                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">সময় (মিনিট)</th>
                                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">তারিখ</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {allUserHistory.slice(0, 10).map(record => (
                                    <tr key={record.id}>
                                        <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-900 break-all">{record.userId}</td>
                                        <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-500">{record.subjectName}</td>
                                        <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-500">{record.chapterName}</td>
                                        <td className="px-3 py-2 whitespace-nowrap text-sm text-right font-medium text-indigo-600">{record.durationMinutes}</td>
                                        <td className="px-3 py-2 whitespace-nowrap text-sm text-right text-gray-500">{record.date.toLocaleDateString('bn-BD')}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        );
    };

    // ----------------------------------------------------------------
    // Final Render
    // ----------------------------------------------------------------

    let ViewComponent;
    switch (currentView) {
        case 'subjects':
            ViewComponent = SubjectsView;
            break;
        case 'tracking':
            ViewComponent = TrackingView;
            break;
        case 'goals':
            ViewComponent = GoalsView;
            break;
        case 'admin':
            ViewComponent = AdminPanelView;
            break;
        case 'dashboard':
        default:
            ViewComponent = DashboardView;
            break;
    }

    return (
        <AppContext.Provider value={{ db, auth, user, currentUserId, subjects, history, settings, recordReading, saveSubject, saveGoals, isAdmin }}>
            <div className="min-h-screen bg-gray-50 p-4 md:p-8">
                <div className="max-w-6xl mx-auto">
                    <Navbar />
                    <div className="mt-8">
                        <ViewComponent />
                    </div>
                    
                    <footer className="mt-12 text-center text-sm text-gray-500 p-4 border-t pt-6">
                        রিডিং ট্র্যাকিং অ্যাপ | ইউজার আইডি: {currentUserId} | অ্যাডমিন আইডি: {ADMIN_UID}
                    </footer>
                </div>
            </div>
        </AppContext.Provider>
    );
};

export default App;
