import React, { useState, useMemo, useRef } from 'react';
import { fmtCompactNum, fmtNum, fmtDate } from '../utils';
import TopPostsShowcase from './TopPostsShowcase';
import UGCDualDateRangePicker from './UGCDualDateRangePicker';

// SVG Platform Brand Icons & Specifications (UGCTrackr Exact)
const PLATFORMS = [
  {
    id: 'tiktok',
    name: 'TikTok',
    color: '#000000',
    glowColor: 'rgba(0, 0, 0, 0.4)',
    iconSvg: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
        <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.88 2.89 2.89 0 0 1-2.89-2.88 2.89 2.89 0 0 1 2.89-2.88c.3 0 .59.04.86.11V9.39a6.38 6.38 0 0 0-.86-.06A6.33 6.33 0 0 0 3 15.67 6.33 6.33 0 0 0 9.34 22a6.33 6.33 0 0 0 6.33-6.33V8.86a8.28 8.28 0 0 0 4.92 1.6V7a4.8 4.8 0 0 1-1-.31z" />
      </svg>
    )
  },
  {
    id: 'instagram',
    name: 'Instagram',
    color: '#E1306C',
    gradient: 'linear-gradient(45deg, #f09433 0%, #e6683c 25%, #dc2743 50%, #cc2366 75%, #bc1888 100%)',
    glowColor: 'rgba(225, 48, 108, 0.4)',
    iconSvg: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" />
      </svg>
    )
  },
  {
    id: 'youtube',
    name: 'YouTube',
    color: '#FF0000',
    glowColor: 'rgba(255, 0, 0, 0.4)',
    iconSvg: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
        <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
      </svg>
    )
  },
  {
    id: 'facebook',
    name: 'Facebook',
    color: '#1877F2',
    glowColor: 'rgba(24, 119, 242, 0.4)',
    iconSvg: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
        <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
      </svg>
    )
  }
];

// Rich Demo Data Generator for Testing and Exploration (UGCTrackr Parity)
function getDemoSubmissions(campaigns = [], creators = []) {
  const now = new Date();

  const c1 = campaigns[0];
  const c2 = campaigns[1];
  const c1Id = c1 ? (c1.id || c1.campaign_id) : 'camp-demo-1';
  const c2Id = c2 ? (c2.id || c2.campaign_id) : 'camp-demo-2';
  const c1Name = c1 ? (c1.name || c1.campaign_name) : 'TEST';
  const c2Name = c2 ? (c2.name || c2.campaign_name) : 'Summer Push 2026';

  const defaultCreators = [
    { id: 'cr-1', name: 'Maya Chen', handle: '@mayachen_ugc' },
    { id: 'cr-2', name: 'Liam Vance', handle: '@liamvance' },
    { id: 'cr-3', name: 'Sophie Taylor', handle: '@sophietaylor_creations' },
    { id: 'cr-4', name: 'Alex Rivera', handle: '@alex_rivera_vids' },
    { id: 'cr-5', name: 'Elena Rostova', handle: '@elena_ugc' }
  ];
  const crList = (creators && creators.length > 0) ? creators : defaultCreators;
  const getCr = idx => crList[idx % crList.length];

  return [
    {
      id: 'demo-sub-1',
      campaign_id: c1Id,
      campaignName: c1Name,
      creator_id: getCr(0).id,
      creator_name: getCr(0).name,
      creator_handle: getCr(0).handle || `@${getCr(0).name.toLowerCase().replace(/\s+/g, '')}`,
      platform: 'tiktok',
      format: 'Hook + Demo',
      status: 'Approved',
      views: 1420500,
      likes: 118400,
      comments: 2840,
      shares: 9200,
      saves: 15400,
      created_at: new Date(now.getTime() - 2 * 3600000).toISOString(), // 2 hrs ago (Today)
      posted_link: 'https://tiktok.com/@mayachen_ugc/video/7289012345',
      title: 'POV: Finding the ultimate gamechanger product 🔥'
    },
    {
      id: 'demo-sub-2',
      campaign_id: c1Id,
      campaignName: c1Name,
      creator_id: getCr(1).id,
      creator_name: getCr(1).name,
      creator_handle: getCr(1).handle || `@${getCr(1).name.toLowerCase().replace(/\s+/g, '')}`,
      platform: 'instagram',
      format: 'Talking Head',
      status: 'Approved',
      views: 890200,
      likes: 74600,
      comments: 1420,
      shares: 3800,
      saves: 11200,
      created_at: new Date(now.getTime() - 16 * 3600000).toISOString(), // 16 hrs ago (Today)
      posted_link: 'https://instagram.com/reel/Cx18920kLz',
      title: 'Stop doing this if you want real results 🛑'
    },
    {
      id: 'demo-sub-3',
      campaign_id: c2Id,
      campaignName: c2Name,
      creator_id: getCr(2).id,
      creator_name: getCr(2).name,
      creator_handle: getCr(2).handle || `@${getCr(2).name.toLowerCase().replace(/\s+/g, '')}`,
      platform: 'youtube',
      format: 'Hook + Demo',
      status: 'Approved',
      views: 640000,
      likes: 48500,
      comments: 980,
      shares: 2100,
      saves: 4600,
      created_at: new Date(now.getTime() - 36 * 3600000).toISOString(), // Yesterday
      posted_link: 'https://youtube.com/shorts/xyz987abc',
      title: 'I tried this for 7 days straight and WOW'
    },
    {
      id: 'demo-sub-4',
      campaign_id: c1Id,
      campaignName: c1Name,
      creator_id: getCr(3).id,
      creator_name: getCr(3).name,
      creator_handle: getCr(3).handle || `@${getCr(3).name.toLowerCase().replace(/\s+/g, '')}`,
      platform: 'tiktok',
      format: 'Wall of Text',
      status: 'Approved',
      views: 512000,
      likes: 39200,
      comments: 690,
      shares: 2300,
      saves: 5900,
      created_at: new Date(now.getTime() - 3 * 86400000).toISOString(), // 3 days ago (This week)
      posted_link: 'https://tiktok.com/@alex_rivera_vids/video/7289567890',
      title: 'Things TikTok made me buy that actually work ✨'
    },
    {
      id: 'demo-sub-5',
      campaign_id: c1Id,
      campaignName: c1Name,
      creator_id: getCr(4).id,
      creator_name: getCr(4).name,
      creator_handle: getCr(4).handle || `@${getCr(4).name.toLowerCase().replace(/\s+/g, '')}`,
      platform: 'instagram',
      format: 'Carousel',
      status: 'Approved',
      views: 385000,
      likes: 29400,
      comments: 540,
      shares: 1200,
      saves: 3800,
      created_at: new Date(now.getTime() - 5 * 86400000).toISOString(), // 5 days ago (This week)
      posted_link: 'https://instagram.com/reel/Cy890123Ab',
      title: '3 steps that completely transformed my routine'
    },
    {
      id: 'demo-sub-6',
      campaign_id: c2Id,
      campaignName: c2Name,
      creator_id: getCr(0).id,
      creator_name: getCr(0).name,
      creator_handle: getCr(0).handle || `@${getCr(0).name.toLowerCase().replace(/\s+/g, '')}`,
      platform: 'youtube',
      format: 'Hook + Demo',
      status: 'Approved',
      views: 310000,
      likes: 22800,
      comments: 420,
      shares: 980,
      saves: 2700,
      created_at: new Date(now.getTime() - 9 * 86400000).toISOString(), // 9 days ago (Last week)
      posted_link: 'https://youtube.com/shorts/qwe456rty',
      title: 'Honest review after testing for a full month'
    },
    {
      id: 'demo-sub-7',
      campaign_id: c1Id,
      campaignName: c1Name,
      creator_id: getCr(1).id,
      creator_name: getCr(1).name,
      creator_handle: getCr(1).handle || `@${getCr(1).name.toLowerCase().replace(/\s+/g, '')}`,
      platform: 'tiktok',
      format: 'Talking Head',
      status: 'Approved',
      views: 265000,
      likes: 19800,
      comments: 380,
      shares: 750,
      saves: 2300,
      created_at: new Date(now.getTime() - 12 * 86400000).toISOString(), // 12 days ago (Last week)
      posted_link: 'https://tiktok.com/@liamvance/video/7290123456',
      title: 'Why everyone is switching to this in 2026'
    },
    {
      id: 'demo-sub-8',
      campaign_id: c1Id,
      campaignName: c1Name,
      creator_id: getCr(2).id,
      creator_name: getCr(2).name,
      creator_handle: getCr(2).handle || `@${getCr(2).name.toLowerCase().replace(/\s+/g, '')}`,
      platform: 'instagram',
      format: 'Hook + Demo',
      status: 'Approved',
      views: 215000,
      likes: 16200,
      comments: 290,
      shares: 610,
      saves: 1900,
      created_at: new Date(now.getTime() - 16 * 86400000).toISOString(), // 16 days ago (This month)
      posted_link: 'https://instagram.com/reel/Cz345678Cd',
      title: 'Unboxing + first impressions test!'
    },
    {
      id: 'demo-sub-9',
      campaign_id: c2Id,
      campaignName: c2Name,
      creator_id: getCr(3).id,
      creator_name: getCr(3).name,
      creator_handle: getCr(3).handle || `@${getCr(3).name.toLowerCase().replace(/\s+/g, '')}`,
      platform: 'facebook',
      format: 'Wall of Text',
      status: 'Approved',
      views: 185000,
      likes: 11400,
      comments: 340,
      shares: 890,
      saves: 950,
      created_at: new Date(now.getTime() - 20 * 86400000).toISOString(), // 20 days ago (This month)
      posted_link: 'https://facebook.com/watch/?v=987654321',
      title: 'Community spotlight: How our customers use it daily'
    },
    {
      id: 'demo-sub-10',
      campaign_id: c1Id,
      campaignName: c1Name,
      creator_id: getCr(4).id,
      creator_name: getCr(4).name,
      creator_handle: getCr(4).handle || `@${getCr(4).name.toLowerCase().replace(/\s+/g, '')}`,
      platform: 'tiktok',
      format: 'Talking Head',
      status: 'Approved',
      views: 145000,
      likes: 10800,
      comments: 210,
      shares: 440,
      saves: 1350,
      created_at: new Date(now.getTime() - 24 * 86400000).toISOString(), // 24 days ago (This month)
      posted_link: 'https://tiktok.com/@elena_ugc/video/7291234567',
      title: 'Quick tip that saves 2 hours every week'
    },
    {
      id: 'demo-sub-11',
      campaign_id: c1Id,
      campaignName: c1Name,
      creator_id: getCr(0).id,
      creator_name: getCr(0).name,
      creator_handle: getCr(0).handle || `@${getCr(0).name.toLowerCase().replace(/\s+/g, '')}`,
      platform: 'instagram',
      format: 'Carousel',
      status: 'Approved',
      views: 112000,
      likes: 8400,
      comments: 160,
      shares: 320,
      saves: 980,
      created_at: new Date(now.getTime() - 35 * 86400000).toISOString(), // 35 days ago (Last month)
      posted_link: 'https://instagram.com/reel/Da123456Ef',
      title: 'Before vs after transformation results'
    },
    {
      id: 'demo-sub-12',
      campaign_id: c2Id,
      campaignName: c2Name,
      creator_id: getCr(1).id,
      creator_name: getCr(1).name,
      creator_handle: getCr(1).handle || `@${getCr(1).name.toLowerCase().replace(/\s+/g, '')}`,
      platform: 'facebook',
      format: 'Hook + Demo',
      status: 'Approved',
      views: 95000,
      likes: 6200,
      comments: 130,
      shares: 410,
      saves: 620,
      created_at: new Date(now.getTime() - 42 * 86400000).toISOString(), // 42 days ago (Last month)
      posted_link: 'https://facebook.com/watch/?v=123456789',
      title: 'Product launch feature breakdown & test'
    }
  ];
}

// Environment policy:
// In development mode (or if REACT_APP_ENABLE_DEMO_MODE is 'true'),
// developers can toggle between simulated test data and live database data.
// In production mode (NODE_ENV === 'production' and REACT_APP_ENABLE_DEMO_MODE !== 'true'),
// simulated data is completely disabled and only live data is rendered.
const isDev = process.env.NODE_ENV !== 'production';
const envDemoConfig = process.env.REACT_APP_ENABLE_DEMO_MODE;
const allowSimulatedData = envDemoConfig === 'true' || (isDev && envDemoConfig !== 'false');

export default function UGCDashboardView({
  campaigns = [],
  submissions = [],
  analytics = [],
  creators = [],
  title = "Dashboard",
  subtitle = "Performance analytics, post metrics, and daily view trends",
  showTopPosts = true,
  onNavigate = null
}) {
  // Individual Toolbar Filters
  const [selectedCampaign, setSelectedCampaign] = useState('all');
  const [dateRange, setDateRange] = useState('all');
  const [customStartDate, setCustomStartDate] = useState(null);
  const [customEndDate, setCustomEndDate] = useState(null);
  const [dateLabel, setDateLabel] = useState('Select date range');
  const [selectedPlatforms, setSelectedPlatforms] = useState([]); // [] = All platforms

  // Deep Filter Modal Filters (Creator & Format)
  const [selectedCreator, setSelectedCreator] = useState('all');
  const [selectedFormat, setSelectedFormat] = useState('all');

  // Chart Presentation Mode
  const [chartMode, setChartMode] = useState('daily'); // 'daily' | 'total'

  // Modals & Popovers
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [hoveredPoint, setHoveredPoint] = useState(null);
  const [chartHoverX, setChartHoverX] = useState(null);

  // Simulated / Live data toggle state:
  // Strictly false in production. In development, defaults to simulated data only if live DB has 0 submissions.
  const [isSimulatedData, setIsSimulatedData] = useState(() => {
    if (!allowSimulatedData) return false;
    return (submissions || []).length === 0;
  });

  // Effective flag: can only be active if allowSimulatedData is true
  const isDemoActive = allowSimulatedData && isSimulatedData;

  const chartContainerRef = useRef(null);

  // Determine active source dataset
  const activeSubmissions = useMemo(() => {
    if (isDemoActive) {
      return getDemoSubmissions(campaigns, creators);
    }
    if ((submissions || []).length > 0) {
      return submissions;
    }
    if ((analytics || []).length > 0) {
      return analytics.map(a => ({
        id: a.submission_id || a.id,
        campaign_id: a.campaign_id,
        creator_id: a.creator_id,
        platform: a.platform,
        posted_link: a.video_url,
        created_at: a.pulled_at || a.created_at,
        status: 'Approved',
        views: a.views,
        likes: a.likes,
        comments: a.comments,
        shares: a.shares,
        saves: a.saves
      }));
    }
    return [];
  }, [isDemoActive, campaigns, creators, submissions, analytics]);

  // Map analytics by submission_id
  const analyticsMap = useMemo(() => {
    const map = {};
    (analytics || []).forEach(a => {
      const subId = a.submission_id || a.id;
      if (subId) map[subId] = a;
    });
    return map;
  }, [analytics]);

  // Individual Platform Toggle Handler
  const handlePlatformToggle = (platformId) => {
    if (platformId === 'all') {
      setSelectedPlatforms([]);
      return;
    }
    setSelectedPlatforms(prev => {
      // If all are currently active, clicking a platform isolates it individually
      if (prev.length === 0) {
        return [platformId];
      }
      // If already active, toggle it off
      if (prev.includes(platformId)) {
        const next = prev.filter(id => id !== platformId);
        return next; // Empty means all
      }
      // Otherwise add it
      return [...prev, platformId];
    });
  };

  // Filter submissions based on all active criteria individually and in combination
  const filteredSubmissions = useMemo(() => {
    const isWithinDateRange = (dateStr) => {
      if (!dateStr) return true;
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return true;

      // 1. Custom date range check
      if (customStartDate && customEndDate) {
        return d >= customStartDate && d <= customEndDate;
      }

      // 2. Preset check
      if (dateRange === 'all') return true;
      const now = new Date();
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

      switch (dateRange) {
        case 'today':
          return d >= startOfToday;
        case 'yesterday': {
          const yest = new Date(startOfToday.getTime() - 86400000);
          return d >= yest && d < startOfToday;
        }
        case 'this_week': {
          const day = now.getDay() || 7;
          const monday = new Date(startOfToday.getTime() - (day - 1) * 86400000);
          return d >= monday;
        }
        case 'last_week': {
          const day = now.getDay() || 7;
          const lastMonday = new Date(startOfToday.getTime() - (day - 1 + 7) * 86400000);
          const thisMonday = new Date(startOfToday.getTime() - (day - 1) * 86400000);
          return d >= lastMonday && d < thisMonday;
        }
        case 'this_month':
          return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
        case 'last_month': {
          const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
          const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
          return d >= lastMonth && d < thisMonthStart;
        }
        case 'this_year':
          return d.getFullYear() === now.getFullYear();
        default:
          return true;
      }
    };

    return activeSubmissions.filter(s => {
      // 1. Campaign filter (Individual)
      if (selectedCampaign !== 'all') {
        const campId = s.campaign_id || s.campaignId;
        if (campId !== selectedCampaign) return false;
      }

      // 2. Platform filter (Individual multi-toggle)
      const a = analyticsMap[s.id || s.submission_id];
      const camp = (campaigns || []).find(c => (c.id || c.campaign_id) === s.campaign_id);
      const plat = (a?.platform || s.platform || camp?.format || 'tiktok').toLowerCase();

      if (selectedPlatforms.length > 0 && !selectedPlatforms.includes('all')) {
        const matches = selectedPlatforms.some(p => plat.includes(p.toLowerCase()));
        if (!matches) return false;
      }

      // 3. Creator filter (from Filter modal)
      if (selectedCreator !== 'all') {
        const creatorId = s.creator_id || s.creatorId;
        if (creatorId !== selectedCreator) return false;
      }

      // 4. Format filter (from Filter modal)
      if (selectedFormat !== 'all') {
        const fmt = s.submission_type || s.format || camp?.format || '';
        if (!fmt.toLowerCase().includes(selectedFormat.toLowerCase())) return false;
      }

      // 5. Date range filter (Individual)
      const postDate = s.created_at || s.approved_date || a?.pulled_at;
      if (!isWithinDateRange(postDate)) return false;

      return true;
    });
  }, [activeSubmissions, selectedCampaign, selectedPlatforms, selectedCreator, selectedFormat, dateRange, customStartDate, customEndDate, analyticsMap, campaigns]);

  // Compute 8-metric KPIs dynamically
  const kpis = useMemo(() => {
    let views = 0;
    let likes = 0;
    let comments = 0;
    let shares = 0;
    let saves = 0;

    filteredSubmissions.forEach(s => {
      const subId = s.id || s.submission_id;
      const a = analyticsMap[subId];
      if (a) {
        views += Number(a.views || 0);
        likes += Number(a.likes || 0);
        comments += Number(a.comments || 0);
        shares += Number(a.shares || 0);
        saves += Number(a.saves || 0);
      } else {
        views += Number(s.views_1w || s.views_72h || s.views_24h || s.views || 0);
        likes += Number(s.likes || 0);
        comments += Number(s.comments || 0);
        shares += Number(s.shares || 0);
        saves += Number(s.saves || 0);
      }
    });

    const totalEng = likes + comments + shares + saves;
    const engagementRate = views > 0 ? ((totalEng / views) * 100).toFixed(2) + '%' : '0.00%';
    const commentRate = views > 0 ? ((comments / views) * 100).toFixed(2) + '%' : '0.00%';

    return {
      videos: filteredSubmissions.length,
      views,
      likes,
      comments,
      shares,
      saves,
      engagementRate,
      commentRate
    };
  }, [filteredSubmissions, analyticsMap]);

  // Aggregate daily views for time-series chart
  const timeSeriesData = useMemo(() => {
    const dailyMap = {};

    filteredSubmissions.forEach(s => {
      const subId = s.id || s.submission_id;
      const a = analyticsMap[subId];
      const views = Number(a?.views || s.views_1w || s.views_72h || s.views_24h || s.views || 0);
      const rawDate = s.created_at || s.approved_date || a?.pulled_at || new Date().toISOString();
      const d = new Date(rawDate);
      if (isNaN(d.getTime())) return;
      const dateKey = d.toISOString().split('T')[0];

      if (!dailyMap[dateKey]) {
        dailyMap[dateKey] = { dateKey, date: d, views: 0, posts: 0 };
      }
      dailyMap[dateKey].views += views;
      dailyMap[dateKey].posts += 1;
    });

    const sortedDays = Object.values(dailyMap).sort((a, b) => a.date - b.date);

    if (sortedDays.length === 0) {
      const dummy = [];
      const now = new Date();
      for (let i = 14; i >= 0; i--) {
        const d = new Date(now.getTime() - i * 86400000);
        const dateKey = d.toISOString().split('T')[0];
        dummy.push({ dateKey, date: d, views: 0, posts: 0 });
      }
      return dummy;
    }

    if (sortedDays.length === 1) {
      const single = sortedDays[0];
      const prev = new Date(single.date.getTime() - 86400000);
      const next = new Date(single.date.getTime() + 86400000);
      return [
        { dateKey: prev.toISOString().split('T')[0], date: prev, views: 0, posts: 0 },
        single,
        { dateKey: next.toISOString().split('T')[0], date: next, views: single.views, posts: single.posts }
      ];
    }

    if (chartMode === 'total') {
      let cumulative = 0;
      return sortedDays.map(pt => {
        cumulative += pt.views;
        return { ...pt, views: cumulative };
      });
    }

    return sortedDays;
  }, [filteredSubmissions, analyticsMap, chartMode]);

  // Chart coordinate geometry calculation
  const chartPoints = useMemo(() => {
    if (timeSeriesData.length === 0) return [];
    const maxViews = Math.max(100, ...timeSeriesData.map(d => d.views));
    const width = 1000;
    const height = 260;
    const padX = 40;
    const padY = 30;
    const usableW = width - padX * 2;
    const usableH = height - padY * 2;

    return timeSeriesData.map((d, idx) => {
      const x = padX + (idx / Math.max(1, timeSeriesData.length - 1)) * usableW;
      const y = height - padY - (d.views / maxViews) * usableH;
      return { ...d, x, y, maxViews, height, width, padX, padY };
    });
  }, [timeSeriesData]);

  // Construct SVG path for line and area
  const svgPaths = useMemo(() => {
    if (chartPoints.length < 2) return { linePath: '', areaPath: '', maxViews: 100 };
    const maxViews = chartPoints[0].maxViews;
    const height = chartPoints[0].height;
    const padY = chartPoints[0].padY;
    const bottomY = height - padY;

    let linePath = `M ${chartPoints[0].x},${chartPoints[0].y}`;
    for (let i = 1; i < chartPoints.length; i++) {
      const prev = chartPoints[i - 1];
      const curr = chartPoints[i];
      const cx = (prev.x + curr.x) / 2;
      linePath += ` C ${cx},${prev.y} ${cx},${curr.y} ${curr.x},${curr.y}`;
    }

    const first = chartPoints[0];
    const last = chartPoints[chartPoints.length - 1];
    const areaPath = `${linePath} L ${last.x},${bottomY} L ${first.x},${bottomY} Z`;

    return { linePath, areaPath, maxViews };
  }, [chartPoints]);

  // Top posts sorted by view count
  const topPosts = useMemo(() => {
    return filteredSubmissions.map(s => {
      const subId = s.id || s.submission_id;
      const a = analyticsMap[subId];
      const views = Number(a?.views || s.views_1w || s.views_72h || s.views_24h || s.views || 0);
      const likes = Number(a?.likes || s.likes || 0);
      const comments = Number(a?.comments || s.comments || 0);
      const shares = Number(a?.shares || s.shares || 0);
      const saves = Number(a?.saves || s.saves || 0);
      const creator = (creators || []).find(c => (c.id || c.creator_id) === (s.creator_id || s.creatorId));
      const campaign = (campaigns || []).find(c => (c.id || c.campaign_id) === s.campaign_id);

      return {
        ...s,
        id: subId,
        views,
        likes,
        comments,
        shares,
        saves,
        platform: (a?.platform || s.platform || campaign?.format || 'tiktok').toLowerCase(),
        creatorName: s.creator_name || creator?.name || 'Creator',
        creatorHandle: s.creator_handle || creator?.handle || `@creator_${subId.slice(0, 4)}`,
        campaignName: campaign?.name || campaign?.campaign_name || s.campaignName || 'Campaign',
        posted_link: s.posted_link || s.video_url || s.drive_link
      };
    }).sort((a, b) => b.views - a.views);
  }, [filteredSubmissions, analyticsMap, creators, campaigns]);

  // Active campaigns for Campaign Progress & Timeline tracking
  const activeCampaigns = useMemo(() => {
    const active = (campaigns || []).filter(c => c.status === 'Active' || c.status === 'Open' || c.status === 'In Progress');
    if (active.length > 0) return active;
    if (campaigns && campaigns.length > 0) return campaigns;
    if (isDemoActive) {
      return [
        { id: 'camp-demo-1', name: 'TEST', videos_needed: 30, deadline: '2026-10-31' },
        { id: 'camp-demo-2', name: 'Summer Push 2026', videos_needed: 50, deadline: '2026-11-15' }
      ];
    }
    return [];
  }, [campaigns, isDemoActive]);

  // Month & year string for Timeline section header
  const currentMonthYear = useMemo(() => {
    const d = new Date();
    const month = d.toLocaleString('default', { month: 'short' });
    const year = d.getFullYear();
    return `${month} ${year}`;
  }, []);

  // Handle chart mouse hover for tooltip
  const handleChartMouseMove = (e) => {
    if (!chartContainerRef.current || chartPoints.length === 0) return;
    const rect = chartContainerRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const pct = Math.max(0, Math.min(1, mouseX / rect.width));
    const targetIdx = Math.round(pct * (chartPoints.length - 1));
    const point = chartPoints[targetIdx];
    if (point) {
      setHoveredPoint(point);
      setChartHoverX(point.x);
    }
  };

  const handleChartMouseLeave = () => {
    setHoveredPoint(null);
    setChartHoverX(null);
  };

  // Deep filters count (Creator & Format in Filter Modal)
  const deepFiltersCount = [
    selectedCreator !== 'all',
    selectedFormat !== 'all'
  ].filter(Boolean).length;

  const clearAllFilters = () => {
    setSelectedCampaign('all');
    setDateRange('all');
    setCustomStartDate(null);
    setCustomEndDate(null);
    setDateLabel('Select date range');
    setSelectedPlatforms([]);
    setSelectedCreator('all');
    setSelectedFormat('all');
    setShowFilterModal(false);
  };

  // Check if date filter is active
  const isDateFilterActive = dateRange !== 'all' || customStartDate !== null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* 0. Environment-Controlled Data Mode Banner */}
      {allowSimulatedData && (
        isDemoActive ? (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'linear-gradient(90deg, rgba(37, 99, 235, 0.14) 0%, rgba(59, 130, 246, 0.06) 100%)',
            border: '1px solid rgba(59, 130, 246, 0.3)',
            borderRadius: 'var(--radius-sm)',
            padding: '10px 16px',
            fontSize: 13,
            color: 'var(--ink)',
            flexWrap: 'wrap',
            gap: 12
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{
                background: '#3b82f6',
                color: '#fff',
                fontSize: 11,
                fontWeight: 800,
                padding: '2px 8px',
                borderRadius: 4,
                textTransform: 'uppercase',
                letterSpacing: 0.5
              }}>
                Dev Mode · Simulated Data
              </span>
              <span style={{ color: 'var(--ink)' }}>
                Showing simulated UGC data for UI testing. Production builds are restricted strictly to live data.
              </span>
            </div>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setIsSimulatedData(false)}
              style={{
                fontSize: 12,
                fontWeight: 600,
                padding: '5px 14px',
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6
              }}
            >
              <span>📡 Switch to Live Data</span>
            </button>
          </div>
        ) : (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'rgba(16, 185, 129, 0.08)',
            border: '1px solid rgba(16, 185, 129, 0.25)',
            borderRadius: 'var(--radius-sm)',
            padding: '10px 16px',
            fontSize: 13,
            color: 'var(--ink)',
            flexWrap: 'wrap',
            gap: 12
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{
                background: '#10b981',
                color: '#fff',
                fontSize: 11,
                fontWeight: 800,
                padding: '2px 8px',
                borderRadius: 4,
                textTransform: 'uppercase',
                letterSpacing: 0.5
              }}>
                Live Data Active
              </span>
              <span style={{ color: 'var(--ink2)' }}>
                Connected directly to Supabase ({submissions.length} submission{submissions.length === 1 ? '' : 's'} in database).
              </span>
            </div>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setIsSimulatedData(true)}
              style={{
                fontSize: 12,
                fontWeight: 600,
                padding: '5px 14px',
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6
              }}
            >
              <span>🧪 Switch to Simulated Data</span>
            </button>
          </div>
        )
      )}

      {/* 1. Header Toolbar (UGCTrackr-style with Individual Direct Controls) */}
      <div className="flex-between" style={{ flexWrap: 'wrap', gap: 16, alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: 26, fontWeight: 800, margin: 0, color: 'var(--ink)' }}>{title}</h2>
          <p style={{ color: 'var(--ink3)', marginTop: 4, fontSize: 13 }}>{subtitle}</p>
        </div>

        {/* Toolbar Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {/* 1. Campaign Selector Dropdown (Filters Individually) */}
          <div style={{ position: 'relative' }}>
            <select
              className="select"
              value={selectedCampaign}
              onChange={e => setSelectedCampaign(e.target.value)}
              title="Filter by campaign individually"
              style={{
                height: 38,
                fontSize: 13,
                fontWeight: 600,
                padding: '0 32px 0 12px',
                borderRadius: 'var(--radius-sm)',
                minWidth: 160,
                border: selectedCampaign !== 'all' ? '1px solid #3b82f6' : '1px solid var(--border)',
                color: selectedCampaign !== 'all' ? '#3b82f6' : 'var(--ink)',
                cursor: 'pointer'
              }}
            >
              <option value="all">
                All Campaigns ({campaigns.length || (isDemoActive ? 2 : 0)})
              </option>
              {campaigns.map(c => (
                <option key={c.id || c.campaign_id} value={c.id || c.campaign_id}>
                  {c.name || c.campaign_name}
                </option>
              ))}
              {campaigns.length === 0 && isDemoActive && (
                <>
                  <option value="camp-demo-1">TEST (Simulated)</option>
                  <option value="camp-demo-2">Summer Push 2026 (Simulated)</option>
                </>
              )}
            </select>
          </div>

          {/* 2. Date Range Picker (Filters Individually) */}
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <button
              className="btn btn-secondary btn-sm"
              style={{
                height: 38,
                fontSize: 13,
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '0 14px',
                background: isDateFilterActive ? 'rgba(59, 130, 246, 0.1)' : 'var(--bg2)',
                border: isDateFilterActive ? '1px solid #3b82f6' : '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                color: isDateFilterActive ? '#3b82f6' : 'var(--ink)',
                cursor: 'pointer'
              }}
              onClick={() => setShowDatePicker(!showDatePicker)}
              title="Filter by date range individually"
            >
              <span>📅 {dateLabel}</span>
              {isDateFilterActive && (
                <span
                  onClick={(e) => {
                    e.stopPropagation();
                    setDateRange('all');
                    setCustomStartDate(null);
                    setCustomEndDate(null);
                    setDateLabel('Select date range');
                  }}
                  title="Clear date filter back to all time"
                  style={{
                    marginLeft: 4,
                    padding: '1px 5px',
                    borderRadius: 4,
                    fontSize: 11,
                    fontWeight: 800,
                    background: 'rgba(59, 130, 246, 0.2)',
                    color: '#3b82f6',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  ✕
                </span>
              )}
            </button>

            <UGCDualDateRangePicker
              isOpen={showDatePicker}
              onClose={() => setShowDatePicker(false)}
              currentRange={{
                preset: dateRange,
                startDate: customStartDate,
                endDate: customEndDate
              }}
              onApply={({ preset, startDate, endDate, label }) => {
                setDateRange(preset);
                setCustomStartDate(startDate);
                setCustomEndDate(endDate);
                setDateLabel(label);
              }}
            />
          </div>

          {/* 3. Platform Quick Toggle Icons (Filters Individually & Independently) */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              background: 'var(--bg2)',
              padding: '3px 5px',
              borderRadius: 'var(--radius-sm)',
              border: selectedPlatforms.length > 0 ? '1px solid #3b82f6' : '1px solid var(--border)'
            }}
          >
            {/* "All" Reset Button */}
            <button
              type="button"
              onClick={() => handlePlatformToggle('all')}
              title="Show all platforms"
              style={{
                height: 30,
                padding: '0 8px',
                borderRadius: 5,
                fontSize: 11,
                fontWeight: 700,
                cursor: 'pointer',
                border: selectedPlatforms.length === 0 ? '1px solid var(--border)' : '1px solid transparent',
                background: selectedPlatforms.length === 0 ? 'var(--surface)' : 'transparent',
                color: selectedPlatforms.length === 0 ? 'var(--ink)' : 'var(--ink3)',
                transition: 'all 0.15s ease'
              }}
            >
              All
            </button>

            {/* Individual Platform Toggle Buttons */}
            {PLATFORMS.map(p => {
              const isSelected = selectedPlatforms.includes(p.id);
              const isAll = selectedPlatforms.length === 0;

              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handlePlatformToggle(p.id)}
                  title={`Filter by ${p.name} individually ${isSelected ? '(active - click to toggle off)' : '(click to filter)'}`}
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: 5,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    border: isSelected
                      ? '2px solid #ffffff'
                      : isAll
                        ? '1px solid rgba(255,255,255,0.08)'
                        : '1px solid transparent',
                    background: isSelected
                      ? (p.gradient || p.color)
                      : isAll
                        ? (p.gradient || p.color)
                        : 'rgba(255,255,255,0.04)',
                    color: '#ffffff',
                    opacity: isSelected ? 1 : isAll ? 0.7 : 0.25,
                    transform: isSelected ? 'scale(1.06)' : 'scale(1)',
                    boxShadow: isSelected ? `0 0 8px ${p.glowColor || 'rgba(255,255,255,0.3)'}` : 'none',
                    transition: 'all 0.15s ease'
                  }}
                >
                  {p.iconSvg}
                </button>
              );
            })}
          </div>

          {/* 4. Filter Button (Deep Multi-Criteria Filtering: Creator, Format) */}
          <button
            className={`btn btn-sm ${deepFiltersCount > 0 ? 'btn-primary' : 'btn-secondary'}`}
            style={{
              height: 38,
              fontSize: 13,
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              cursor: 'pointer'
            }}
            onClick={() => setShowFilterModal(true)}
            title="Open advanced filter drawer for multi-criteria filtering"
          >
            <span>🎛️ Filter</span>
            {deepFiltersCount > 0 && (
              <span style={{
                background: '#ffffff',
                color: '#000000',
                borderRadius: '50%',
                width: 18,
                height: 18,
                fontSize: 11,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 800,
                marginLeft: 2
              }}>
                {deepFiltersCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* 2. 8-Metric KPI Grid (UGCTrackr-exact) */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 16
        }}
      >
        {/* Metric 1: Videos */}
        <div className="stat-card" style={{ padding: '18px 20px', position: 'relative' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="stat-label" style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink3)' }}>Videos</span>
            <span title="Total delivered & approved videos matching current filters" style={{ fontSize: 11, color: 'var(--ink3)', cursor: 'help' }}>ⓘ</span>
          </div>
          <div className="stat-value" style={{ fontSize: 28, fontWeight: 800, marginTop: 6, color: 'var(--ink)' }}>
            {fmtNum(kpis.videos)}
          </div>
        </div>

        {/* Metric 2: Views */}
        <div className="stat-card" style={{ padding: '18px 20px', position: 'relative' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="stat-label" style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink3)' }}>Views</span>
            <span title="Verified views across filtered platforms and dates" style={{ fontSize: 11, color: 'var(--ink3)', cursor: 'help' }}>ⓘ</span>
          </div>
          <div className="stat-value text-blue" style={{ fontSize: 28, fontWeight: 800, marginTop: 6 }}>
            {fmtNum(kpis.views)}
          </div>
        </div>

        {/* Metric 3: Likes */}
        <div className="stat-card" style={{ padding: '18px 20px', position: 'relative' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="stat-label" style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink3)' }}>Likes</span>
            <span title="Total likes on verified content" style={{ fontSize: 11, color: 'var(--ink3)', cursor: 'help' }}>ⓘ</span>
          </div>
          <div className="stat-value" style={{ fontSize: 28, fontWeight: 800, marginTop: 6, color: 'var(--ink)' }}>
            {fmtNum(kpis.likes)}
          </div>
        </div>

        {/* Metric 4: Comments */}
        <div className="stat-card" style={{ padding: '18px 20px', position: 'relative' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="stat-label" style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink3)' }}>Comments</span>
            <span title="Total comments across matching posts" style={{ fontSize: 11, color: 'var(--ink3)', cursor: 'help' }}>ⓘ</span>
          </div>
          <div className="stat-value" style={{ fontSize: 28, fontWeight: 800, marginTop: 6, color: 'var(--ink)' }}>
            {fmtNum(kpis.comments)}
          </div>
        </div>

        {/* Metric 5: Shares */}
        <div className="stat-card" style={{ padding: '18px 20px', position: 'relative' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="stat-label" style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink3)' }}>Shares</span>
            <span title="Total viral shares & reposts" style={{ fontSize: 11, color: 'var(--ink3)', cursor: 'help' }}>ⓘ</span>
          </div>
          <div className="stat-value" style={{ fontSize: 28, fontWeight: 800, marginTop: 6, color: 'var(--ink)' }}>
            {fmtNum(kpis.shares)}
          </div>
        </div>

        {/* Metric 6: Saves */}
        <div className="stat-card" style={{ padding: '18px 20px', position: 'relative' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="stat-label" style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink3)' }}>Saves</span>
            <span title="Total bookmarks and saves" style={{ fontSize: 11, color: 'var(--ink3)', cursor: 'help' }}>ⓘ</span>
          </div>
          <div className="stat-value" style={{ fontSize: 28, fontWeight: 800, marginTop: 6, color: 'var(--ink)' }}>
            {fmtNum(kpis.saves)}
          </div>
        </div>

        {/* Metric 7: Engagement Rate */}
        <div className="stat-card" style={{ padding: '18px 20px', position: 'relative' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="stat-label" style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink3)' }}>Engagement Rate</span>
            <span title="Total interactions divided by verified views" style={{ fontSize: 11, color: 'var(--ink3)', cursor: 'help' }}>ⓘ</span>
          </div>
          <div className="stat-value text-green" style={{ fontSize: 28, fontWeight: 800, marginTop: 6 }}>
            {kpis.engagementRate}
          </div>
        </div>

        {/* Metric 8: Comment Rate */}
        <div className="stat-card" style={{ padding: '18px 20px', position: 'relative' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="stat-label" style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink3)' }}>Comment Rate</span>
            <span title="Total comments divided by verified views" style={{ fontSize: 11, color: 'var(--ink3)', cursor: 'help' }}>ⓘ</span>
          </div>
          <div className="stat-value" style={{ fontSize: 28, fontWeight: 800, marginTop: 6, color: 'var(--ink)' }}>
            {kpis.commentRate}
          </div>
        </div>
      </div>

      {/* 3. Performance Graph ("Daily Views by Post Date") */}
      <div className="premium-card" style={{ padding: '24px 28px', position: 'relative' }}>
        <div className="flex-between mb-20" style={{ flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: 'var(--ink)' }}>
                Daily Views by Post Date
              </h3>
              <span title="Current verified views for matching posts, grouped by publication date" style={{ fontSize: 12, color: 'var(--ink3)', cursor: 'help' }}>
                ⓘ
              </span>
            </div>
            <p style={{ color: 'var(--ink3)', fontSize: 12, margin: '4px 0 0 0' }}>
              Current views for matching posts, grouped by publish date
            </p>
          </div>

          {/* Toggle: [ Daily | Total ] */}
          <div style={{
            display: 'flex',
            background: 'var(--bg2)',
            padding: 3,
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border)'
          }}>
            <button
              onClick={() => setChartMode('daily')}
              style={{
                background: chartMode === 'daily' ? 'var(--surface)' : 'transparent',
                color: chartMode === 'daily' ? 'var(--ink)' : 'var(--ink3)',
                border: chartMode === 'daily' ? '1px solid var(--border)' : '1px solid transparent',
                borderRadius: 4,
                padding: '4px 12px',
                fontSize: 12,
                fontWeight: 700,
                cursor: 'pointer'
              }}
            >
              Daily
            </button>
            <button
              onClick={() => setChartMode('total')}
              style={{
                background: chartMode === 'total' ? 'var(--surface)' : 'transparent',
                color: chartMode === 'total' ? 'var(--ink)' : 'var(--ink3)',
                border: chartMode === 'total' ? '1px solid var(--border)' : '1px solid transparent',
                borderRadius: 4,
                padding: '4px 12px',
                fontSize: 12,
                fontWeight: 700,
                cursor: 'pointer'
              }}
            >
              Total
            </button>
          </div>
        </div>

        {/* SVG Interactive Chart Area */}
        <div
          ref={chartContainerRef}
          onMouseMove={handleChartMouseMove}
          onMouseLeave={handleChartMouseLeave}
          style={{
            position: 'relative',
            width: '100%',
            height: 260,
            cursor: 'crosshair',
            userSelect: 'none'
          }}
        >
          <svg
            viewBox="0 0 1000 260"
            preserveAspectRatio="none"
            style={{ width: '100%', height: '100%', overflow: 'visible' }}
          >
            <defs>
              <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#2563eb" stopOpacity="0.35" />
                <stop offset="100%" stopColor="#2563eb" stopOpacity="0.0" />
              </linearGradient>
            </defs>

            {/* Horizontal Grid lines and Y labels */}
            {[0, 0.25, 0.5, 0.75, 1].map((pct, i) => {
              const y = 260 - 30 - pct * (260 - 60);
              const val = Math.round(pct * (svgPaths.maxViews || 100));
              return (
                <g key={i}>
                  <line
                    x1="40"
                    y1={y}
                    x2="960"
                    y2={y}
                    stroke="var(--border)"
                    strokeDasharray="4 4"
                    strokeWidth="1"
                  />
                  <text
                    x="32"
                    y={y + 4}
                    textAnchor="end"
                    fill="var(--ink3)"
                    fontSize="11"
                    fontFamily="inherit"
                  >
                    {fmtCompactNum(val)}
                  </text>
                </g>
              );
            })}

            {/* Gradient Area Fill */}
            {svgPaths.areaPath && (
              <path d={svgPaths.areaPath} fill="url(#chartGradient)" />
            )}

            {/* Main Trend Line */}
            {svgPaths.linePath && (
              <path
                d={svgPaths.linePath}
                fill="none"
                stroke="#3b82f6"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}

            {/* Hover Crosshair Vertical Line */}
            {chartHoverX !== null && (
              <line
                x1={chartHoverX}
                y1="10"
                x2={chartHoverX}
                y2="230"
                stroke="#3b82f6"
                strokeWidth="1.5"
                strokeDasharray="3 3"
              />
            )}

            {/* Hover Point Marker */}
            {hoveredPoint && (
              <circle
                cx={hoveredPoint.x}
                cy={hoveredPoint.y}
                r="5"
                fill="#2563eb"
                stroke="#fff"
                strokeWidth="2"
              />
            )}

            {/* X-axis Date Labels */}
            {chartPoints.filter((_, i) => i === 0 || i === Math.floor(chartPoints.length / 2) || i === chartPoints.length - 1).map((pt, i) => (
              <text
                key={i}
                x={pt.x}
                y="252"
                textAnchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'}
                fill="var(--ink3)"
                fontSize="11"
                fontFamily="inherit"
              >
                {fmtDate(pt.date)}
              </text>
            ))}
          </svg>

          {/* Floating Hover Tooltip */}
          {hoveredPoint && (
            <div
              style={{
                position: 'absolute',
                top: Math.max(10, hoveredPoint.y - 70),
                left: `${(hoveredPoint.x / 1000) * 100}%`,
                transform: 'translateX(-50%)',
                background: '#111827',
                color: '#fff',
                padding: '8px 12px',
                borderRadius: 6,
                fontSize: 12,
                boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
                pointerEvents: 'none',
                whiteSpace: 'nowrap',
                zIndex: 20
              }}
            >
              <div style={{ color: '#9ca3af', fontSize: 11, marginBottom: 2 }}>
                {fmtDate(hoveredPoint.date)}
              </div>
              <div style={{ fontWeight: 800, fontSize: 14 }}>
                {fmtNum(hoveredPoint.views)} views
              </div>
              <div style={{ color: '#60a5fa', fontSize: 11, marginTop: 2 }}>
                {hoveredPoint.posts} {hoveredPoint.posts === 1 ? 'post' : 'posts'}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 4. Filter Modal (Advanced Multi-Criteria Filtering: Creator, Format, Combined) */}
      {showFilterModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: 16
          }}
          onClick={() => setShowFilterModal(false)}
        >
          <div
            className="premium-card"
            style={{
              width: '100%',
              maxWidth: 520,
              padding: 24,
              borderRadius: 'var(--radius)',
              background: 'var(--surface)',
              maxHeight: '90vh',
              overflowY: 'auto'
            }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex-between mb-20">
              <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Filter Dashboard</h3>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setShowFilterModal(false)}
                style={{ fontSize: 16, padding: '4px 8px' }}
              >
                ✕
              </button>
            </div>

            {/* Campaign Selection */}
            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 8 }}>
                Campaign
              </label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                <button
                  className={`btn btn-sm ${selectedCampaign === 'all' ? 'btn-primary' : 'btn-ghost'}`}
                  style={{ fontSize: 12, padding: '4px 12px' }}
                  onClick={() => setSelectedCampaign('all')}
                >
                  All Campaigns
                </button>
                {campaigns.map(c => {
                  const id = c.id || c.campaign_id;
                  const active = selectedCampaign === id;
                  return (
                    <button
                      key={id}
                      className={`btn btn-sm ${active ? 'btn-primary' : 'btn-ghost'}`}
                      style={{ fontSize: 12, padding: '4px 12px' }}
                      onClick={() => setSelectedCampaign(id)}
                    >
                      {c.name || c.campaign_name}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Platform Selection */}
            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 8 }}>
                Platforms
              </label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                <button
                  className={`btn btn-sm ${selectedPlatforms.length === 0 ? 'btn-primary' : 'btn-ghost'}`}
                  style={{ fontSize: 12, padding: '4px 12px' }}
                  onClick={() => setSelectedPlatforms([])}
                >
                  All Platforms
                </button>
                {PLATFORMS.map(p => {
                  const active = selectedPlatforms.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      className={`btn btn-sm ${active ? 'btn-primary' : 'btn-ghost'}`}
                      style={{ fontSize: 12, padding: '4px 12px', display: 'inline-flex', alignItems: 'center', gap: 6 }}
                      onClick={() => handlePlatformToggle(p.id)}
                    >
                      {p.iconSvg} {p.name}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Creator / UGC Engineer Selection */}
            {creators.length > 0 && (
              <div style={{ marginBottom: 20 }}>
                <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 8 }}>
                  Creator / UGC Engineer
                </label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 120, overflowY: 'auto' }}>
                  <button
                    className={`btn btn-sm ${selectedCreator === 'all' ? 'btn-primary' : 'btn-ghost'}`}
                    style={{ fontSize: 12, padding: '4px 12px' }}
                    onClick={() => setSelectedCreator('all')}
                  >
                    All Creators
                  </button>
                  {creators.slice(0, 15).map(cr => {
                    const id = cr.id || cr.creator_id;
                    const active = selectedCreator === id;
                    return (
                      <button
                        key={id}
                        className={`btn btn-sm ${active ? 'btn-primary' : 'btn-ghost'}`}
                        style={{ fontSize: 12, padding: '4px 12px' }}
                        onClick={() => setSelectedCreator(id)}
                      >
                        {cr.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Format Selection */}
            <div style={{ marginBottom: 24 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 8 }}>
                Format
              </label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {['all', 'Hook + Demo', 'Wall of Text', 'Carousel', 'Talking Head'].map(fmt => {
                  const active = selectedFormat === fmt;
                  return (
                    <button
                      key={fmt}
                      className={`btn btn-sm ${active ? 'btn-primary' : 'btn-ghost'}`}
                      style={{ fontSize: 12, padding: '4px 12px' }}
                      onClick={() => setSelectedFormat(fmt)}
                    >
                      {fmt === 'all' ? 'All Formats' : fmt}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex-between" style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
              <button className="btn btn-ghost btn-sm" onClick={clearAllFilters}>
                Clear all
              </button>
              <button className="btn btn-primary btn-sm" onClick={() => setShowFilterModal(false)}>
                Apply filter
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 5. Top Posts Section (Cards & Table Views) */}
      {showTopPosts && (
        <TopPostsShowcase
          posts={topPosts}
          title="Top posts"
          subtitle=""
        />
      )}

      {/* 6. Campaign Progress Section */}
      {activeCampaigns.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="flex-between" style={{ alignItems: 'center' }}>
            <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: 'var(--ink)' }}>
              Campaign Progress
            </h3>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => onNavigate ? onNavigate('content-gallery') : null}
              style={{
                fontSize: 12,
                fontWeight: 600,
                background: 'var(--bg2)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                padding: '6px 14px',
                cursor: 'pointer'
              }}
            >
              Go to all posts
            </button>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
              gap: 16
            }}
          >
            {activeCampaigns.map(c => {
              const campSubs = activeSubmissions.filter(s => (s.campaign_id === c.id || s.campaignId === c.id) && s.status === 'Approved');
              const delivered = campSubs.length;
              const target = Number(c.videos_needed) || (delivered > 0 ? delivered + 10 : 30);
              const pct = Math.min(100, Math.round((delivered / target) * 100));

              return (
                <div
                  key={c.id || c.campaign_id}
                  className="premium-card"
                  style={{
                    padding: '20px 24px',
                    background: 'var(--surface)',
                    borderRadius: 'var(--radius)',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between'
                  }}
                >
                  <div className="flex-between" style={{ alignItems: 'center' }}>
                    <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--ink)' }}>
                      {c.name || c.campaign_name}
                    </div>
                    <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink)' }}>
                      {delivered}/{target} posts
                    </div>
                  </div>

                  {/* Progress Track & Fill */}
                  <div style={{
                    width: '100%',
                    height: 4,
                    background: 'var(--bg2)',
                    borderRadius: 999,
                    margin: '16px 0 12px',
                    overflow: 'hidden'
                  }}>
                    <div style={{
                      width: `${pct}%`,
                      height: '100%',
                      background: '#ffffff',
                      borderRadius: 999,
                      transition: 'width 0.3s ease'
                    }} />
                  </div>

                  {/* Subtitle */}
                  <div style={{ fontSize: 12, color: 'var(--ink3)' }}>
                    {target} posts target
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 7. Timeline Section */}
      {activeCampaigns.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: 'var(--ink)' }}>
              Timeline
            </h3>
            <span style={{ fontSize: 13, color: 'var(--ink3)', fontWeight: 500 }}>
              {currentMonthYear}
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {activeCampaigns.map(c => {
              let daysLeftText = '115 days left';
              if (c.deadline) {
                const diff = Math.ceil((new Date(c.deadline).getTime() - new Date().getTime()) / 86400000);
                if (diff > 0) daysLeftText = `${diff} days left`;
                else if (diff === 0) daysLeftText = 'Due today';
                else daysLeftText = `${Math.abs(diff)}d overdue`;
              } else {
                const start = c.start_date || c.created_at ? new Date(c.start_date || c.created_at) : new Date();
                const flightDays = 120;
                const diff = Math.max(1, flightDays - Math.floor((new Date().getTime() - start.getTime()) / 86400000));
                daysLeftText = `${diff} days left`;
              }

              return (
                <div
                  key={c.id || c.campaign_id}
                  className="premium-card"
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '16px 20px',
                    background: 'var(--surface)',
                    borderRadius: 'var(--radius)'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                    <div style={{
                      width: 36,
                      height: 36,
                      borderRadius: '50%',
                      background: 'linear-gradient(135deg, #1d4ed8, #3b82f6)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#fff',
                      fontSize: 15,
                      fontWeight: 800,
                      boxShadow: '0 0 10px rgba(59, 130, 246, 0.35)'
                    }}>
                      📈
                    </div>
                    <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink)' }}>
                      {c.name || c.campaign_name}
                    </div>
                  </div>

                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
                    {daysLeftText}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
