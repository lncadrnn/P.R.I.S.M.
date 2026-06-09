"use client";

import React, { useEffect, useRef, useState } from "react";
import { motion, useScroll, useTransform, useSpring, AnimatePresence } from "framer-motion";
import Lenis from "lenis";
import { 
  Shield, 
  Cpu, 
  Layers, 
  Activity, 
  Download, 
  ArrowRight, 
  CheckCircle, 
  AlertTriangle, 
  Clock, 
  Sliders, 
  Search,
  Eye,
  RefreshCw,
  Mail,
  User,
  ExternalLink,
  ChevronRight,
  FileText,
  Menu,
  X,
  Sun,
  Moon
} from "lucide-react";

// Types for interactive components
interface SolutionCard {
  id: number;
  name: string;
  avatar: string;
  anomalyType: string;
  confidence: number;
  camRegion: { top: string; left: string; width: string; height: string };
  telemetry: string[];
}

interface DemoResult {
  verdict: string;
  confidence: number;
  metrics: {
    type: string;
    latency: string;
    anomaly?: string;
    url?: string;
    camRegion?: { top: string; left: string; width: string; height: string };
    details?: string[];
    jitterFrames?: number[];
    syncGap?: string;
    taglishBert?: string;
    limeHighlight?: { text: string; flag: boolean }[];
    domainReputation?: string;
    integrity?: string;
  };
}

interface PhotoSample {
  id: number;
  name: string;
  url: string;
  anomaly: string;
  confidence: number;
  camRegion: { top: string; left: string; width: string; height: string };
}

interface VideoSample {
  id: number;
  name: string;
  anomaly: string;
  confidence: number;
  latency: string;
}

export default function PrismLanding() {
  const containerRef = useRef<HTMLDivElement>(null);
  const solutionsRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLElement>(null);
  const [clockInference, setClockInference] = useState(0);
  const [selectedExtensionTab, setSelectedExtensionTab] = useState("passive");
  const [demoText, setDemoText] = useState("Grabe, check this out! AI-generated image daw ito ni President na ginawa sa AI app kahapon. Totoo ba ito?");
  const [demoResult, setDemoResult] = useState<DemoResult | null>(null);
  const [demoLoading, setDemoLoading] = useState(false);

  const [activeWorkspaceTab, setActiveWorkspaceTab] = useState<"text" | "photo" | "video" | "url">("text");
  const [selectedPhotoSample, setSelectedPhotoSample] = useState<PhotoSample | null>(null);
  const [selectedVideoSample, setSelectedVideoSample] = useState<VideoSample | null>(null);
  const [demoUrl, setDemoUrl] = useState("");
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(false);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const storedTheme = localStorage.getItem("theme");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    if (storedTheme === "dark" || (!storedTheme && prefersDark)) {
      setIsDarkMode(true);
      document.documentElement.classList.add("dark");
    } else {
      setIsDarkMode(false);
      document.documentElement.classList.remove("dark");
    }
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  const toggleDarkMode = () => {
    if (isDarkMode) {
      document.documentElement.classList.remove("dark");
      localStorage.setItem("theme", "light");
      setIsDarkMode(false);
    } else {
      document.documentElement.classList.add("dark");
      localStorage.setItem("theme", "dark");
      setIsDarkMode(true);
    }
  };

  const photoSamples = [
    { id: 1, name: "GAN Portrait", url: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&q=80&w=400", anomaly: "High Frequency GAN Artifact / Frequency Space Noise", confidence: 98.4, camRegion: { top: "15%", left: "20%", width: "50%", height: "40%" } },
    { id: 2, name: "Latent Diffusion", url: "https://images.unsplash.com/photo-1522075469751-3a6694fb2f61?auto=format&fit=crop&q=80&w=400", anomaly: "Latent Diffusion / Eyebrow Inconsistency", confidence: 94.1, camRegion: { top: "25%", left: "15%", width: "70%", height: "30%" } },
    { id: 3, name: "Casual GAN", url: "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?auto=format&fit=crop&q=80&w=400", anomaly: "Boundary Mask Incongruity / Texture Warp", confidence: 95.3, camRegion: { top: "30%", left: "35%", width: "40%", height: "45%" } }
  ];

  const videoSamples = [
    { id: 1, name: "Broadcast Synthetic Clip", anomaly: "Lip-Sync Phoneme Displacement", confidence: 96.8, latency: "890ms" },
    { id: 2, name: "Interview Jitter", anomaly: "Temporal Jitter & Face Warp", confidence: 91.2, latency: "1040ms" }
  ];

  const [isDraggingOver, setIsDraggingOver] = useState(false);

  const getDynamicLimeHighlight = (text: string) => {
    const tokens = text.split(/(\s+)/);
    return tokens.map((token) => {
      const isSynthetic = /synthetic|ai|manipulated|fake|leak|generated|compromised|deepfake/i.test(token);
      return { text: token, flag: isSynthetic };
    });
  };

  const handleGlobalDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(true);
  };

  const handleGlobalDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(false);
  };

  const handleGlobalDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      const fileType = file.type;
      
      if (fileType.startsWith("image/")) {
        setActiveWorkspaceTab("photo");
        const reader = new FileReader();
        reader.onload = (event) => {
          const sample = {
            id: 99,
            name: file.name,
            url: event.target?.result as string,
            anomaly: "Custom Scanned Image / Generative Noise Anomaly",
            confidence: 95.7,
            camRegion: { top: "20%", left: "25%", width: "50%", height: "45%" }
          };
          setSelectedPhotoSample(sample);
          
          // Trigger scan directly
          setDemoLoading(true);
          setDemoResult(null);
          setTimeout(() => {
            setDemoResult({
              verdict: "HIGH RISK",
              confidence: sample.confidence,
              metrics: {
                type: "photo",
                latency: "380ms",
                anomaly: sample.anomaly,
                url: sample.url,
                camRegion: sample.camRegion,
                details: ["FREQ_NOISE: 91.2%", "ViT_ATTN_MAP: FLAG", "EDGE_WARPING: DETECTED"]
              }
            });
            setDemoLoading(false);
          }, 1500);
        };
        reader.readAsDataURL(file);
      } else if (fileType.startsWith("video/")) {
        setActiveWorkspaceTab("video");
        const sample = {
          id: 99,
          name: file.name,
          anomaly: "Custom Scanned Video / Lip-Sync Anomaly",
          confidence: 92.5,
          latency: "940ms"
        };
        setSelectedVideoSample(sample);
        
        // Trigger scan directly
        setDemoLoading(true);
        setDemoResult(null);
        setTimeout(() => {
          setDemoResult({
            verdict: "HIGH RISK",
            confidence: sample.confidence,
            metrics: {
              type: "video",
              latency: sample.latency,
              anomaly: sample.anomaly,
              jitterFrames: [3, 5],
              syncGap: "24ms",
              details: ["TEMPORAL_JITTER: 89%", "ORAL_FORENSICS: FLAG", "PHONEME_GAP: 24ms"]
            }
          });
          setDemoLoading(false);
        }, 1500);
      }
    }
  };

  // Initialize Lenis Smooth Scroll
  useEffect(() => {
    const lenis = new Lenis({
      duration: 1.4,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      orientation: "vertical",
      gestureOrientation: "vertical",
      smoothWheel: true,
      wheelMultiplier: 1.1,
      touchMultiplier: 2,
    });

    function raf(time: number) {
      lenis.raf(time);
      requestAnimationFrame(raf);
    }
    requestAnimationFrame(raf);

    return () => {
      lenis.destroy();
    };
  }, []);

  // Animate the inference clock in Bento section when in viewport
  useEffect(() => {
    let interval: NodeJS.Timeout;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          let count = 0;
          interval = setInterval(() => {
            count += 17;
            if (count >= 412) {
              setClockInference(412);
              clearInterval(interval);
            } else {
              setClockInference(count);
            }
          }, 20);
        } else {
          setClockInference(0);
        }
      },
      { threshold: 0.5 }
    );

    const target = document.getElementById("inference-clock-trigger");
    if (target) observer.observe(target);

    return () => {
      if (interval) clearInterval(interval);
      if (target) observer.unobserve(target);
    };
  }, []);

  // Track scroll for Convergence Grid & Lens Focus Footer

  const { scrollYProgress: solutionsScrollProgress } = useScroll({
    target: solutionsRef,
    offset: ["start end", "end start"]
  });

  const { scrollYProgress: footerScrollProgress } = useScroll({
    target: footerRef,
    offset: ["start end", "end end"]
  });

  // Smooth springs for fluid deceleration mapping
  const smoothSolutionsProgress = useSpring(solutionsScrollProgress, {
    damping: 24,
    stiffness: 75,
  });

  const smoothFooterProgress = useSpring(footerScrollProgress, {
    damping: 20,
    stiffness: 80,
  });

  // Asymmetrical starting coordinates for the 8 convergence cards
  // Progress 0.0 means dispersed, 0.6 means clustered tightly
  const cardTransforms = [
    {
      x: useTransform(smoothSolutionsProgress, [0.0, 0.5], [-350, 0]),
      y: useTransform(smoothSolutionsProgress, [0.0, 0.5], [-250, 0]),
      scale: useTransform(smoothSolutionsProgress, [0.0, 0.5], [0.8, 1]),
      rotate: useTransform(smoothSolutionsProgress, [0.0, 0.5], [-15, 0]),
    },
    {
      x: useTransform(smoothSolutionsProgress, [0.0, 0.5], [0, 0]),
      y: useTransform(smoothSolutionsProgress, [0.0, 0.5], [-350, 0]),
      scale: useTransform(smoothSolutionsProgress, [0.0, 0.5], [0.8, 1]),
      rotate: useTransform(smoothSolutionsProgress, [0.0, 0.5], [0, 0]),
    },
    {
      x: useTransform(smoothSolutionsProgress, [0.0, 0.5], [350, 0]),
      y: useTransform(smoothSolutionsProgress, [0.0, 0.5], [-250, 0]),
      scale: useTransform(smoothSolutionsProgress, [0.0, 0.5], [0.8, 1]),
      rotate: useTransform(smoothSolutionsProgress, [0.0, 0.5], [15, 0]),
    },
    {
      x: useTransform(smoothSolutionsProgress, [0.0, 0.5], [400, 0]),
      y: useTransform(smoothSolutionsProgress, [0.0, 0.5], [0, 0]),
      scale: useTransform(smoothSolutionsProgress, [0.0, 0.5], [0.8, 1]),
      rotate: useTransform(smoothSolutionsProgress, [0.0, 0.5], [10, 0]),
    },
    {
      x: useTransform(smoothSolutionsProgress, [0.0, 0.5], [350, 0]),
      y: useTransform(smoothSolutionsProgress, [0.0, 0.5], [250, 0]),
      scale: useTransform(smoothSolutionsProgress, [0.0, 0.5], [0.8, 1]),
      rotate: useTransform(smoothSolutionsProgress, [0.0, 0.5], [-10, 0]),
    },
    {
      x: useTransform(smoothSolutionsProgress, [0.0, 0.5], [0, 0]),
      y: useTransform(smoothSolutionsProgress, [0.0, 0.5], [350, 0]),
      scale: useTransform(smoothSolutionsProgress, [0.0, 0.5], [0.8, 1]),
      rotate: useTransform(smoothSolutionsProgress, [0.0, 0.5], [0, 0]),
    },
    {
      x: useTransform(smoothSolutionsProgress, [0.0, 0.5], [-350, 0]),
      y: useTransform(smoothSolutionsProgress, [0.0, 0.5], [250, 0]),
      scale: useTransform(smoothSolutionsProgress, [0.0, 0.5], [0.8, 1]),
      rotate: useTransform(smoothSolutionsProgress, [0.0, 0.5], [10, 0]),
    },
    {
      x: useTransform(smoothSolutionsProgress, [0.0, 0.5], [-400, 0]),
      y: useTransform(smoothSolutionsProgress, [0.0, 0.5], [0, 0]),
      scale: useTransform(smoothSolutionsProgress, [0.0, 0.5], [0.8, 1]),
      rotate: useTransform(smoothSolutionsProgress, [0.0, 0.5], [-10, 0]),
    },
  ];

  // Footer blur transition: drop filters from heavy blur down to structural clarity
  const footerBlur = useTransform(smoothFooterProgress, [0.1, 0.95], ["blur(35px)", "blur(0px)"]);
  const footerOpacity = useTransform(smoothFooterProgress, [0.1, 0.95], [0.4, 1]);

  // Data arrays

  const solutionCards: SolutionCard[] = [
    {
      id: 1,
      name: "Striped Portrait GAN",
      avatar: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&q=80&w=600",
      anomalyType: "GAN Artifact / High Frequency Noise",
      confidence: 98.4,
      camRegion: { top: "15%", left: "20%", width: "50%", height: "40%" },
      telemetry: ["FREQ_NOISE: 89.2%", "EYE_ASYNCHRONY: TRUE", "GAN_GRID_DETECT: 0.98"]
    },
    {
      id: 2,
      name: "Long-haired Diffusion",
      avatar: "https://images.unsplash.com/photo-1522075469751-3a6694fb2f61?auto=format&fit=crop&q=80&w=600",
      anomalyType: "Latent Diffusion / Eyebrow Inconsistency",
      confidence: 94.1,
      camRegion: { top: "25%", left: "15%", width: "70%", height: "30%" },
      telemetry: ["DIFFUSION_SIGNATURE: 0.94", "HAIR_COHERENCE: FAILED", "EDGE_DISTORTION: TRUE"]
    },
    {
      id: 3,
      name: "Smiling Outdoor AI Portrait",
      avatar: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&q=80&w=600",
      anomalyType: "Lip-Sync Displacement",
      confidence: 96.8,
      camRegion: { top: "50%", left: "30%", width: "40%", height: "35%" },
      telemetry: ["LIP_SYNC_DISPLACEMENT: 0.96", "PHONEME_GAP: 24ms", "ORAL_FORENSICS: RED"]
    },
    {
      id: 4,
      name: "Hat & Sunglasses Blend",
      avatar: "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&q=80&w=600",
      anomalyType: "Boundary Mask Incongruity",
      confidence: 91.2,
      camRegion: { top: "10%", left: "25%", width: "55%", height: "35%" },
      telemetry: ["MASK_MISALIGNMENT: 0.91", "SPECULAR_MISMATCH: TRUE", "SHADOW_VECTOR: ERR"]
    },
    {
      id: 5,
      name: "Casual Portrait GAN",
      avatar: "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?auto=format&fit=crop&q=80&w=600",
      anomalyType: "Generative Textures Detection",
      confidence: 95.3,
      camRegion: { top: "30%", left: "35%", width: "40%", height: "45%" },
      telemetry: ["GENERATIVE_NOISE: 95.3%", "IRIS_ASYMMETRY: TRUE", "COLOR_SPACE_ERR: 0.82"]
    },
    {
      id: 6,
      name: "Young Hoodie Portrait",
      avatar: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=600",
      anomalyType: "Asymmetrical Ear Forensic",
      confidence: 97.9,
      camRegion: { top: "40%", left: "10%", width: "35%", height: "50%" },
      telemetry: ["EAR_COHERENCE_GAP: 0.97", "SPECULAR_EAR_RATIO: FAILED", "ViT_LAYER_4: FLAG"]
    },
    {
      id: 7,
      name: "Glasses Portrait Diffusion",
      avatar: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&q=80&w=600",
      anomalyType: "Glasses Reflection Displacement",
      confidence: 93.6,
      camRegion: { top: "20%", left: "20%", width: "60%", height: "25%" },
      telemetry: ["SPECULAR_REFLECTION: ERR", "REFRACTIVE_INDEX_SHIFT: 0.93", "ViT_CLASSIFIER: 0.96"]
    },
    {
      id: 8,
      name: "Cheerful Man AI Portrait",
      avatar: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&q=80&w=600",
      anomalyType: "Jawline Artifact Fusion",
      confidence: 99.1,
      camRegion: { top: "60%", left: "25%", width: "50%", height: "30%" },
      telemetry: ["JAW_BLUR_COEFFICIENT: 0.99", "ViT_EDGE_RESONANCE: TRUE", "CNN_LATE_FUSION: FLAG"]
    }
  ];



  // Handler for Interactive Demo Form
  const handleDemoVerify = (e: React.FormEvent) => {
    e.preventDefault();
    setDemoLoading(true);
    setDemoResult(null);
    setTimeout(() => {
      if (activeWorkspaceTab === "text") {
        const containsTaglish = /grabe|daw|ito|totoo|ba/i.test(demoText);
        const containsSynthetic = /synthetic|ai|manipulated|fake|leak|generated/i.test(demoText);
        setDemoResult({
          verdict: containsSynthetic ? "HIGH RISK" : "NEUTRAL/LOW RISK",
          confidence: containsSynthetic ? 96.8 : 72.4,
          metrics: {
            type: "text",
            taglishBert: containsTaglish ? "Flagged: Taglish Disinformation Pattern" : "Neutral Syntax",
            latency: "248ms",
            limeHighlight: getDynamicLimeHighlight(demoText)
          }
        });
      } else if (activeWorkspaceTab === "photo") {
        const sample = selectedPhotoSample || photoSamples[0];
        setDemoResult({
          verdict: "HIGH RISK",
          confidence: sample.confidence,
          metrics: {
            type: "photo",
            latency: "380ms",
            anomaly: sample.anomaly,
            url: sample.url,
            camRegion: sample.camRegion,
            details: ["FREQ_NOISE: 91.2%", "ViT_ATTN_MAP: FLAG", "EDGE_WARPING: DETECTED"]
          }
        });
      } else if (activeWorkspaceTab === "video") {
        const sample = selectedVideoSample || videoSamples[0];
        setDemoResult({
          verdict: "HIGH RISK",
          confidence: sample.confidence,
          metrics: {
            type: "video",
            latency: sample.latency,
            anomaly: sample.anomaly,
            jitterFrames: [3, 5],
            syncGap: "24ms",
            details: ["TEMPORAL_JITTER: 89%", "ORAL_FORENSICS: FLAG", "PHONEME_GAP: 24ms"]
          }
        });
      } else if (activeWorkspaceTab === "url") {
        const isSuspicious = /synthetic|fake|leak|compromised/i.test(demoUrl) || demoUrl.length % 2 === 0;
        setDemoResult({
          verdict: isSuspicious ? "HIGH RISK" : "NEUTRAL/LOW RISK",
          confidence: isSuspicious ? 92.4 : 14.8,
          metrics: {
            type: "url",
            latency: "510ms",
            domainReputation: isSuspicious ? "Low Trust Domain" : "Secure Domain",
            integrity: isSuspicious ? "FAILED" : "PASSED",
            details: ["METADATA_INTEGRITY: FLAG", "SHARING_SPEED: EXTREMELY HIGH", "PROPAGATION_SCORE: 88/100"]
          }
        });
      }
      setDemoLoading(false);
    }, 1500);
  };

  return (
    <div ref={containerRef} className="min-h-screen bg-theme-bg dark:bg-[#0B0F19] text-theme-text dark:text-slate-50 transition-colors duration-300 selection:bg-[#3CC4DB]/30 selection:text-slate-900 overflow-x-clip font-sans relative">
      

      {/* 1. HEADER & NAVIGATION (Editorial & Sleek Morphing Pill Header) */}
      <header className={`sticky top-3 md:top-6 z-50 w-[92%] max-w-5xl bg-white/95 dark:bg-slate-950/95 backdrop-blur-md border border-slate-200/80 dark:border-slate-800/80 mx-auto mt-3 md:mt-6 mb-4 md:mb-6 shadow-[0_8px_30px_rgba(0,0,0,0.03)] dark:shadow-[0_8px_30px_rgba(0,0,0,0.2)] transition-all duration-300 flex flex-col items-center ${isMobileMenuOpen ? 'rounded-[2rem] py-4 px-6' : 'rounded-full py-2 md:py-2.5 px-4 md:px-8'}`}>
        <div className="flex justify-between items-center w-full">
          <div className="flex md:flex-1 items-center gap-3">
            {/* Flat Minimalist PRISM Emblem */}
            <div className="w-9 h-9 flex items-center justify-center">
              <svg viewBox="0 0 100 100" className="w-full h-full fill-none stroke-2">
                <polygon points="50,15 85,80 15,80" className="stroke-[#0077BE]" />
                <line x1="50" y1="15" x2="50" y2="80" className="stroke-[#3CC4DB]" />
                <line x1="50" y1="50" x2="15" y2="80" className="stroke-[#3CC4DB]" />
                <line x1="50" y1="50" x2="85" y2="80" className="stroke-[#3CC4DB]" />
              </svg>
            </div>
            <div>
              <span className="font-serif text-xl font-bold tracking-tight text-slate-900 dark:text-slate-50">PRISM</span>
            </div>
          </div>

          <nav className="hidden md:flex md:flex-1 justify-center items-center gap-5 lg:gap-8 text-sm font-semibold text-slate-600 dark:text-slate-400">
            <motion.a 
              href="#solutions" 
              whileHover={{ scale: 1.03, y: -0.5 }}
              whileTap={{ scale: 0.95 }}
              className="hover:text-slate-900 dark:hover:text-slate-50 transition-colors cursor-pointer whitespace-nowrap"
            >
              Synthetic Gallery
            </motion.a>
            <motion.a 
              href="#bento" 
              whileHover={{ scale: 1.03, y: -0.5 }}
              whileTap={{ scale: 0.95 }}
              className="hover:text-slate-900 dark:hover:text-slate-50 transition-colors cursor-pointer whitespace-nowrap"
            >
              How It Works
            </motion.a>
            <motion.a 
              href="#extension" 
              whileHover={{ scale: 1.03, y: -0.5 }}
              whileTap={{ scale: 0.95 }}
              className="hover:text-slate-900 dark:hover:text-slate-50 transition-colors cursor-pointer whitespace-nowrap"
            >
              Extension
            </motion.a>
            <motion.a 
              href="#publications" 
              whileHover={{ scale: 1.03, y: -0.5 }}
              whileTap={{ scale: 0.95 }}
              className="hover:text-slate-900 dark:hover:text-slate-50 transition-colors cursor-pointer whitespace-nowrap"
            >
              Research
            </motion.a>
          </nav>

          <div className="hidden md:flex md:flex-1 justify-end items-center gap-3">
            <button
              onClick={toggleDarkMode}
              className="p-2 bg-[#F4F1EA] dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-full transition-all text-slate-800 dark:text-slate-200 cursor-pointer"
              aria-label="Toggle Dark Mode"
            >
              {isDarkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>

            <motion.a 
              href="#extension" 
              whileHover={{ scale: 1.03, y: -0.5 }}
              whileTap={{ scale: 0.95 }}
              transition={{ type: "spring", stiffness: 400, damping: 15 }}
              className="flex items-center gap-1.5 px-3.5 py-1.5 bg-slate-950 dark:bg-slate-50 hover:bg-slate-800 dark:hover:bg-slate-200 text-[#FDFBF7] dark:text-slate-950 text-sm font-bold rounded-full shadow-sm transition-colors cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>Install Extension</span>
            </motion.a>
          </div>

          {/* Mobile hamburger menu toggle button */}
          <div className="flex md:hidden items-center gap-2">
            <button
              onClick={toggleDarkMode}
              className="p-2 bg-[#F4F1EA] dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-full transition-all text-slate-800 dark:text-slate-200 cursor-pointer"
              aria-label="Toggle Dark Mode"
            >
              {isDarkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>

            <button
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="p-1.5 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 focus:outline-none transition-colors"
              aria-label="Toggle Menu"
            >
              {isMobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>
        </div>

        {/* Mobile dropdown nav drawer inside the morphed header card */}
        <AnimatePresence>
          {isMobileMenuOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25, ease: "easeInOut" }}
              className="overflow-hidden md:hidden w-full flex flex-col gap-4 mt-4 pt-4 border-t border-slate-200/60 dark:border-slate-800/60"
            >
              <nav className="flex flex-col gap-2.5 text-sm font-bold text-slate-600 dark:text-slate-400">
                <a 
                  href="#solutions" 
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="hover:text-slate-900 dark:hover:text-slate-100 transition-colors py-2 px-3 hover:bg-slate-100/60 dark:hover:bg-slate-900/60 rounded-xl"
                >
                  Synthetic Gallery
                </a>
                <a 
                  href="#bento" 
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="hover:text-slate-900 dark:hover:text-slate-100 transition-colors py-2 px-3 hover:bg-slate-100/60 dark:hover:bg-slate-900/60 rounded-xl"
                >
                  How It Works
                </a>
                <a 
                  href="#extension" 
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="hover:text-slate-900 dark:hover:text-slate-100 transition-colors py-2 px-3 hover:bg-slate-100/60 dark:hover:bg-slate-900/60 rounded-xl"
                >
                  Extension
                </a>
                <a 
                  href="#publications" 
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="hover:text-slate-900 dark:hover:text-slate-100 transition-colors py-2 px-3 hover:bg-slate-100/60 dark:hover:bg-slate-900/60 rounded-xl"
                >
                  Research
                </a>
                
                <div className="h-px bg-slate-200/60 dark:bg-slate-800/60 my-1.5" />

                {/* Dark Mode toggle inside mobile drawer */}
                <button 
                  onClick={toggleDarkMode}
                  className="flex items-center justify-between w-full py-2.5 px-3 hover:bg-slate-100/60 dark:hover:bg-slate-900/60 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 rounded-xl transition-colors font-bold text-sm cursor-pointer"
                >
                  <div className="flex items-center gap-2">
                    {isDarkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                    <span>Theme Mode</span>
                  </div>
                  <span className="text-xs text-slate-400 dark:text-slate-500 font-mono font-bold uppercase">
                    {isDarkMode ? "Dark" : "Light"}
                  </span>
                </button>
                
                <a 
                  href="#extension" 
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="flex items-center justify-center gap-2 w-full py-3 bg-[#DC143C] hover:bg-[#b01030] text-[#FDFBF7] font-bold rounded-full shadow-md transition-colors"
                >
                  <Download className="w-4 h-4" />
                  <span>Install Extension</span>
                </a>
              </nav>
            </motion.div>
          )}
        </AnimatePresence>
      </header>

      {/* 2. HERO SECTION (00:00 Canvas Physics) */}
      <section className="relative h-[calc(100dvh-90px)] md:h-[calc(100dvh-120px)] flex flex-col items-center justify-center px-4 pt-2 md:pt-4 pb-4 md:pb-6 overflow-hidden border-b border-slate-200/60 dark:border-slate-800/60">
        <div className="relative z-10 w-full max-w-[95%] xl:max-w-[98%] mx-auto flex flex-col items-center text-center justify-center flex-1 min-h-0">
          
          {/* Node Tree Layout (Imitating user screenshot) */}
          <div className="relative w-full max-w-[95%] xl:max-w-[98%] h-[230px] sm:h-[280px] md:h-[320px] lg:h-[350px] xl:h-[380px] mx-auto overflow-visible mb-3 md:mb-5 flex items-center justify-center flex-shrink min-h-0">
            
            {/* Desktop Branching Connector Lines */}
            <div className="absolute inset-0 pointer-events-none hidden md:block z-0">
              <svg viewBox="0 0 1000 360" className="w-full h-full stroke-slate-200/70 dark:stroke-slate-800/70 stroke-[1.5] fill-none" preserveAspectRatio="none">
                {/* Horizontal Main Axis */}
                <line x1="80" y1="180" x2="940" y2="180" />
                
                {/* Diagonal Left Branches */}
                <line x1="330" y1="180" x2="190" y2="70" />
                <line x1="360" y1="180" x2="230" y2="290" />
                
                {/* Diagonal Right Branches */}
                <line x1="670" y1="180" x2="770" y2="70" />
                <line x1="640" y1="180" x2="790" y2="290" />
 
                {/* Branching connection node points */}
                <circle cx="190" cy="70" r="3.5" className="fill-[#0077BE]" />
                <circle cx="230" cy="290" r="3.5" className="fill-[#3CC4DB]" />
                <circle cx="770" cy="70" r="3.5" className="fill-[#0077BE]" />
                <circle cx="790" cy="290" r="3.5" className="fill-[#3CC4DB]" />
              </svg>
            </div>
 
            {/* Desktop Absolute-Positioned Nodes */}
            <div className="hidden md:block absolute inset-0 z-10 pointer-events-auto">
              {/* Far Left Avatar: Synthetic scan target */}
              <div className="absolute w-20 h-20 sm:w-24 sm:h-24 md:w-28 md:h-28 lg:w-30 lg:h-30 xl:w-36 xl:h-36 rounded-2xl md:rounded-[2rem] border-4 border-white dark:border-slate-800 shadow-[0_12px_30px_rgba(0,0,0,0.06)] dark:shadow-[0_12px_30px_rgba(0,0,0,0.3)] overflow-hidden left-[1.5%] top-[50%] -translate-y-1/2 group transition-transform duration-500 hover:scale-105">
                <img src="https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&q=80&w=400" className="w-full h-full object-cover filter saturate-75 contrast-125" alt="PRISM Target Scan" />
                <div className="absolute inset-0 bg-[#3CC4DB]/15 border border-[#3CC4DB]/40 animate-pulse" />
              </div>
 
              {/* Top Left Badge (Yellowish Gradient): GAN Identifier */}
              <div className="absolute w-14 h-14 sm:w-16 sm:h-16 md:w-18 md:h-18 lg:w-20 lg:h-20 xl:w-24 xl:h-24 bg-gradient-to-br from-amber-50 to-amber-100 dark:from-amber-950/35 dark:to-amber-900/35 border border-amber-200 dark:border-amber-900/40 shadow-[0_8px_24px_rgba(245,158,11,0.1)] dark:shadow-none rounded-2xl md:rounded-3xl flex flex-col items-center justify-center left-[14%] top-[10%] -translate-y-1/2 transition-transform duration-300 hover:-translate-y-1/3 hover:scale-105 cursor-pointer group">
                <Cpu className="w-5 h-5 sm:w-6 sm:h-6 lg:w-8 lg:h-8 xl:w-9 xl:h-9 text-amber-600 dark:text-amber-400 group-hover:scale-110 transition-transform" />
                <span className="text-[7px] sm:text-[8px] lg:text-[9px] font-mono font-bold text-amber-800 dark:text-amber-300 uppercase tracking-widest mt-0.5 sm:mt-1">GAN Scan</span>
              </div>
 
              {/* Bottom Left Badge (Cyan Gradient): Diffusion Engine */}
              <div className="absolute w-14 h-14 sm:w-16 sm:h-16 md:w-18 md:h-18 lg:w-20 lg:h-20 xl:w-24 xl:h-24 bg-gradient-to-br from-cyan-50 to-cyan-100 dark:from-cyan-950/35 dark:to-cyan-900/35 border border-cyan-200 dark:border-cyan-900/40 shadow-[0_8px_24px_rgba(6,182,212,0.1)] dark:shadow-none rounded-2xl md:rounded-3xl flex flex-col items-center justify-center left-[18%] bottom-[10%] translate-y-1/2 transition-transform duration-300 hover:translate-y-1/3 hover:scale-105 cursor-pointer group">
                <Layers className="w-5 h-5 sm:w-6 sm:h-6 lg:w-8 lg:h-8 xl:w-9 xl:h-9 text-cyan-600 dark:text-cyan-400 group-hover:scale-110 transition-transform" />
                <span className="text-[7px] sm:text-[8px] lg:text-[9px] font-mono font-bold text-cyan-800 dark:text-cyan-300 uppercase tracking-widest mt-0.5 sm:mt-1">Diffusion</span>
              </div>
 
              {/* Center Logo Container */}
              <motion.div 
                className="absolute w-36 h-36 sm:w-44 sm:h-44 md:w-48 md:h-48 lg:w-56 lg:h-56 xl:w-72 xl:h-72 left-[50%] top-[50%] -translate-x-1/2 -translate-y-1/2 flex items-center justify-center cursor-pointer"
                whileHover={{ scale: 1.05 }}
                transition={{ type: "spring", stiffness: 150, damping: 12 }}
              >
                {/* PRISM Emblem Vector */}
                <svg viewBox="0 0 200 200" className="w-[90%] h-[90%] fill-none">
                  <circle cx="100" cy="100" r="85" stroke="#3CC4DB" strokeWidth="2" strokeDasharray="60 30 10 5" className="opacity-80 rotate-[35deg] origin-center" />
                  <circle cx="100" cy="100" r="75" stroke="#0077BE" strokeWidth="1" strokeDasharray="40 20" className="opacity-60 -rotate-[15deg] origin-center" />
                  <polygon points="100,45 155,140 45,140" stroke="#3CC4DB" strokeWidth="3" className="drop-shadow-[0_0_12px_rgba(60,196,219,0.3)]" />
                  <line x1="100" y1="45" x2="100" y2="140" stroke="#0077BE" strokeWidth="2" />
                  <line x1="100" y1="105" x2="45" y2="140" stroke="#0077BE" strokeWidth="1.5" />
                  <line x1="100" y1="105" x2="155" y2="140" stroke="#0077BE" strokeWidth="1.5" />
                  <path d="M5,100 L100,100" stroke="currentColor" className="text-slate-200 dark:text-slate-800" strokeWidth="2.5" />
                  <path d="M100,100 L195,65" stroke="#3CC4DB" strokeWidth="2.5" className="opacity-95" />
                  <path d="M100,100 L195,80" stroke="#00A2C9" strokeWidth="2.5" className="opacity-90" />
                  <path d="M100,100 L195,95" stroke="#008BB4" strokeWidth="2" className="opacity-85" />
                  <path d="M100,100 L195,110" stroke="#0077BE" strokeWidth="2" className="opacity-80" />
                  <path d="M100,100 L195,125" stroke="#005A92" strokeWidth="1.5" className="opacity-75" />
                </svg>
              </motion.div>
 
              {/* Top Right Badge (Rose/Orange Gradient): Synthetic Sentry */}
              <div className="absolute w-14 h-14 sm:w-16 sm:h-16 md:w-18 md:h-18 lg:w-20 lg:h-20 xl:w-24 xl:h-24 bg-gradient-to-br from-rose-50 to-rose-100 dark:from-rose-950/35 dark:to-rose-900/35 border border-rose-200 dark:border-rose-900/40 shadow-[0_8px_24px_rgba(244,63,94,0.1)] dark:shadow-none rounded-2xl md:rounded-3xl flex flex-col items-center justify-center right-[18%] top-[10%] -translate-y-1/2 transition-transform duration-300 hover:-translate-y-1/3 hover:scale-105 cursor-pointer group">
                <Shield className="w-5 h-5 sm:w-6 sm:h-6 lg:w-8 lg:h-8 xl:w-9 xl:h-9 text-rose-600 dark:text-rose-400 group-hover:scale-110 transition-transform" />
                <span className="text-[7px] sm:text-[8px] lg:text-[9px] font-mono font-bold text-rose-800 dark:text-rose-300 uppercase tracking-widest mt-0.5 sm:mt-1">Sentry</span>
              </div>
 
              {/* Bottom Right Avatar: Target Scan */}
              <div className="absolute w-20 h-20 sm:w-24 sm:h-24 md:w-28 md:h-28 lg:w-30 lg:h-30 xl:w-36 xl:h-36 rounded-2xl md:rounded-[2rem] border-4 border-white dark:border-slate-800 shadow-[0_12px_30px_rgba(0,0,0,0.06)] dark:shadow-[0_12px_30px_rgba(0,0,0,0.3)] overflow-hidden right-[14%] bottom-[10%] translate-y-1/2 group transition-transform duration-500 hover:scale-105">
                <img src="https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&q=80&w=400" className="w-full h-full object-cover filter saturate-75 contrast-125" alt="PRISM Target Scan" />
                <div className="absolute inset-0 bg-[#0077BE]/15 border border-[#0077BE]/40 animate-pulse" />
              </div>
 
              {/* Far Right Badge (White): Tracker */}
              <div className="absolute w-14 h-14 sm:w-16 sm:h-16 md:w-18 md:h-18 lg:w-20 lg:h-20 xl:w-24 xl:h-24 bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800/80 shadow-[0_8px_24px_rgba(0,0,0,0.03)] dark:shadow-none rounded-2xl md:rounded-3xl flex flex-col items-center justify-center right-[1.5%] top-[50%] -translate-y-1/2 transition-transform duration-300 hover:scale-105 cursor-pointer group">
                <Eye className="w-5 h-5 sm:w-6 sm:h-6 lg:w-8 lg:h-8 xl:w-9 xl:h-9 text-slate-700 dark:text-slate-300 group-hover:scale-110 transition-transform" />
                <span className="text-[7px] sm:text-[8px] lg:text-[9px] font-mono font-bold text-slate-700 dark:text-slate-300 uppercase tracking-widest mt-0.5 sm:mt-1">Tracker</span>
              </div>
            </div>
 
            {/* Mobile Layout (md:hidden Stacked Cluster) */}
            <div className="md:hidden flex flex-col items-center gap-3 w-full max-w-xs mx-auto px-4 mt-2 relative">
              {/* Central Logo Container */}
              <div className="relative w-28 h-28 flex items-center justify-center z-10">
                <svg viewBox="0 0 200 200" className="w-full h-full fill-none">
                  <circle cx="100" cy="100" r="85" stroke="#3CC4DB" strokeWidth="2" strokeDasharray="60 30 10 5" className="opacity-80 rotate-[35deg] origin-center" />
                  <circle cx="100" cy="100" r="75" stroke="#0077BE" strokeWidth="1" strokeDasharray="40 20" className="opacity-60 -rotate-[15deg] origin-center" />
                  <polygon points="100,45 155,140 45,140" stroke="#3CC4DB" strokeWidth="3" />
                  <line x1="100" y1="45" x2="100" y2="140" stroke="#0077BE" strokeWidth="2" />
                  <line x1="100" y1="105" x2="45" y2="140" stroke="#0077BE" strokeWidth="1.5" />
                  <line x1="100" y1="105" x2="155" y2="140" stroke="#0077BE" strokeWidth="1.5" />
                  <path d="M5,100 L100,100" stroke="currentColor" className="text-slate-200 dark:text-slate-800" strokeWidth="2.5" />
                  <path d="M100,100 L195,65" stroke="#3CC4DB" strokeWidth="2.5" />
                  <path d="M100,100 L195,80" stroke="#00A2C9" strokeWidth="2.5" />
                  <path d="M100,100 L195,95" stroke="#008BB4" strokeWidth="2" />
                  <path d="M100,100 L195,110" stroke="#0077BE" strokeWidth="2" />
                  <path d="M100,100 L195,125" stroke="#005A92" strokeWidth="1.5" />
                </svg>
              </div>

              {/* Minimalist circular orbit badges */}
              <div className="flex flex-wrap justify-center gap-1.5 w-full z-10">
                <div className="bg-white/85 dark:bg-slate-900/85 backdrop-blur-sm border border-slate-200/80 dark:border-slate-800/80 rounded-full px-2.5 py-1 flex items-center gap-1 shadow-sm">
                  <Cpu className="w-3 h-3 text-amber-600" />
                  <span className="text-[9px] font-bold text-slate-700 dark:text-slate-300">GAN Scan</span>
                </div>
                <div className="bg-white/85 dark:bg-slate-900/85 backdrop-blur-sm border border-slate-200/80 dark:border-slate-800/80 rounded-full px-2.5 py-1 flex items-center gap-1 shadow-sm">
                  <Layers className="w-3 h-3 text-cyan-600" />
                  <span className="text-[9px] font-bold text-slate-700 dark:text-slate-300">Diffusion</span>
                </div>
                <div className="bg-white/85 dark:bg-slate-900/85 backdrop-blur-sm border border-slate-200/80 dark:border-slate-800/80 rounded-full px-2.5 py-1 flex items-center gap-1 shadow-sm">
                  <Shield className="w-3 h-3 text-rose-600" />
                  <span className="text-[9px] font-bold text-slate-700 dark:text-slate-300">Sentry</span>
                </div>
                <div className="bg-white/85 dark:bg-slate-900/85 backdrop-blur-sm border border-slate-200/80 dark:border-slate-800/80 rounded-full px-2.5 py-1 flex items-center gap-1 shadow-sm">
                  <Eye className="w-3 h-3 text-[#0077BE]" />
                  <span className="text-[9px] font-bold text-slate-700 dark:text-slate-300">Tracker</span>
                </div>
              </div>
              
              {/* Overlapping premium avatars instead of blocky layout */}
              <div className="flex -space-x-3 justify-center z-10 mt-0.5">
                <div className="w-10 h-10 rounded-full border-2 border-white dark:border-slate-900 shadow-md overflow-hidden relative">
                  <img src="https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&q=80&w=200" className="w-full h-full object-cover filter saturate-75" alt="PRISM Mobile Scan" />
                  <div className="absolute inset-0 bg-[#3CC4DB]/15 border border-[#3CC4DB]/30 rounded-full" />
                </div>
                <div className="w-10 h-10 rounded-full border-2 border-white dark:border-slate-900 shadow-md overflow-hidden relative">
                  <img src="https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&q=80&w=200" className="w-full h-full object-cover filter saturate-75" alt="PRISM Mobile Scan" />
                  <div className="absolute inset-0 bg-[#0077BE]/15 border border-[#0077BE]/30 rounded-full" />
                </div>
              </div>
            </div>
 
          </div>
 
          {/* Editorial Title */}
          <motion.h1 
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="mt-2 md:mt-3 font-serif text-xl sm:text-3xl md:text-5xl lg:text-6xl font-extrabold tracking-tight text-slate-900 dark:text-slate-50 leading-[1.1] max-w-4xl px-2"
          >
            Identification of <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#0077BE] to-[#3CC4DB]">Synthetic Media</span> & Disinformation
          </motion.h1>
 
          {/* Subtitle */}
          <motion.p 
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6 }}
            className="mt-2 md:mt-3 text-[10px] sm:text-xs md:text-sm lg:text-base text-slate-600 dark:text-slate-400 max-w-2xl font-medium leading-relaxed px-4"
          >
            PRISM is a multimodal deep learning system combining Taglish-aware NLP, CNN-ViT classifiers, and frame-level video forensics to detect AI-generated images passively in real time.
          </motion.p>
 
          {/* Call to Actions */}
          <motion.div 
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.8 }}
            className="mt-3 md:mt-5 flex flex-col sm:flex-row gap-2.5 justify-center items-center w-full max-w-xs sm:max-w-none px-4"
          >
            <a 
              href="#demo"
              className="flex sm:inline-flex w-full sm:w-auto justify-center items-center gap-2 px-6 py-2.5 md:px-8 md:py-3.5 bg-[#DC143C] hover:bg-[#b01030] text-[#FDFBF7] font-bold rounded-full shadow-lg transition-all transform hover:-translate-y-1 text-xs md:text-sm"
            >
              <span>Test Forensics Demo</span>
              <ArrowRight className="w-4 h-4" />
            </a>
            <a 
              href="#extension"
              className="flex sm:inline-flex w-full sm:w-auto justify-center items-center gap-2 px-6 py-2.5 md:px-8 md:py-3.5 bg-[#F4F1EA] dark:bg-slate-900 hover:bg-slate-200 dark:hover:bg-slate-800 border border-slate-200/80 dark:border-slate-800/80 text-slate-800 dark:text-slate-200 font-bold rounded-full shadow-sm transition-all transform hover:-translate-y-1 text-xs md:text-sm"
            >
              <Shield className="w-4 h-4 text-[#0077BE]" />
              <span>Explore Chrome Extension</span>
            </a>
          </motion.div>
        </div>
        {/* Dynamic Wave Grid background texture */}
        <div className="absolute inset-0 z-0 opacity-[0.03] pointer-events-none bg-[radial-gradient(#0077BE_1.5px,transparent_1.5px)] [background-size:24px_24px]" />
      </section>
 
      {/* 3. THE INTERACTIVE SOLUTIONS GRID (00:01 - 00:03 Scroll Physics) */}
      <section ref={solutionsRef} id="solutions" className="relative min-h-[120vh] bg-[#F8F6F0] dark:bg-slate-950 py-0 border-b border-slate-200/60 dark:border-slate-800/60 overflow-hidden">
        {/* Sticky Anchoring Container */}
        <div className="sticky top-0 h-screen w-full flex flex-col justify-center items-center overflow-hidden z-10 px-6">
          
          {/* Centered Anchor Typography */}
          <div className="text-center max-w-xl z-20 pointer-events-none select-none my-10 bg-[#F8F6F0]/90 dark:bg-slate-950/90 p-6 backdrop-blur-sm rounded-3xl border border-slate-200/40 dark:border-slate-800/40 shadow-sm">
            <h2 className="font-serif text-4xl md:text-6xl font-extrabold tracking-tight text-slate-900 dark:text-slate-50 leading-tight">
              Visual Forensics Solutions
            </h2>
            <p className="mt-3 text-xs md:text-sm font-bold tracking-widest text-[#0077BE] uppercase">
              Asymmetrical Scroll Clustering Mapping
            </p>
            <p className="mt-4 text-xs font-semibold text-slate-500 dark:text-slate-400">
              Scroll down to watch visual portrait forensics assemble and cluster close to the visual forensics window, and hover over each portrait to activate anomalous Class Activation Map (CAM) overlays.
            </p>
          </div>

          {/* Drifting Convergence Canvas */}
          <div className="absolute inset-0 w-full h-full pointer-events-auto">
            {solutionCards.map((card, index) => {
              const transform = cardTransforms[index];
              const leftPositions = [
                "calc(50% - 440px)", // 1. Top-Left
                "calc(50% - 112px)", // 2. Top-Center
                "calc(50% + 220px)", // 3. Top-Right
                "calc(50% + 340px)", // 4. Right-Center
                "calc(50% + 220px)", // 5. Bottom-Right
                "calc(50% - 112px)", // 6. Bottom-Center
                "calc(50% - 440px)", // 7. Bottom-Left
                "calc(50% - 540px)"  // 8. Left-Center
              ];
              const topPositions = [
                "calc(50% - 290px)", // 1. Top-Left
                "calc(50% - 380px)", // 2. Top-Center
                "calc(50% - 290px)", // 3. Top-Right
                "calc(50% - 150px)", // 4. Right-Center
                "calc(50% + 140px)", // 5. Bottom-Right
                "calc(50% + 200px)", // 6. Bottom-Center
                "calc(50% + 140px)", // 7. Bottom-Left
                "calc(50% - 150px)"  // 8. Left-Center
              ];

              return (
                <motion.div
                  key={card.id}
                  style={{
                    x: transform.x,
                    y: transform.y,
                    scale: transform.scale,
                    rotate: transform.rotate,
                    left: leftPositions[index],
                    top: topPositions[index],
                  }}
                  className="absolute w-44 md:w-56 aspect-[3/4] group bg-[#F4F1EA] dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden cursor-crosshair shadow-md hover:shadow-2xl transition-all duration-500"
                >
                  {/* Portrait Asset */}
                  <img 
                    src={card.avatar} 
                    alt={card.name} 
                    className="w-full h-full object-cover filter saturate-75 group-hover:saturate-100 transition-all duration-500" 
                  />

                  {/* Glassmorphism Border Shadow */}
                  <div className="absolute inset-0 border-2 border-transparent group-hover:border-[#3CC4DB]/60 rounded-2xl transition-colors pointer-events-none duration-500" />

                  {/* CAM (Class Activation Map) Diagnostic Heatmap Overlay */}
                  <div className="absolute inset-0 bg-[#000]/20 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />
                  
                  {/* Glowing heatmap circle representing localized synthesis anomaly */}
                  <div 
                    style={{
                      top: card.camRegion.top,
                      left: card.camRegion.left,
                      width: card.camRegion.width,
                      height: card.camRegion.height,
                    }}
                    className="absolute rounded-full bg-radial from-[#DC143C]/50 via-[#DC143C]/20 to-transparent blur-md opacity-0 group-hover:opacity-100 scale-75 group-hover:scale-110 transition-all duration-500 pointer-events-none" 
                  />

                  {/* Grid Lines Overlay representing scanning */}
                  <div className="absolute inset-0 bg-[linear-gradient(to_right,#3CC4DB15_1px,transparent_1px),linear-gradient(to_bottom,#3CC4DB15_1px,transparent_1px)] bg-[size:10px_10px] opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />

                  {/* Diagnostic telemetry details visible on hover */}
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-900/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 p-4 flex flex-col justify-end text-left select-none">
                    <span className="text-[10px] font-mono text-[#3CC4DB] font-bold tracking-widest uppercase mb-1">
                      {card.anomalyType}
                    </span>
                    <span className="text-white text-xs font-bold leading-tight truncate">
                      {card.name}
                    </span>
                    <span className="text-[#DC143C] text-[10px] font-mono font-bold tracking-wider mt-1.5 border-t border-slate-700/60 pt-1">
                      ANOMALY CONFIDENCE // {card.confidence}%
                    </span>
                    {/* Live values */}
                    <div className="mt-2 text-[8px] font-mono text-slate-400 space-y-0.5 leading-none">
                      {card.telemetry.map((t, idx) => <div key={idx}>{t}</div>)}
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>

        </div>
      </section>

      {/* 4. BENTO FEATURES WORKSPACE (00:04 - 00:06 Framework Alignment) */}
      <section id="bento" className="max-w-7xl mx-auto px-6 py-32 border-b border-slate-200/60 dark:border-slate-800/60">
        <div className="text-center mb-16">
          <h2 className="font-serif text-3xl md:text-5xl font-extrabold tracking-tight text-slate-900 dark:text-slate-50">
            Late-Fusion Forensic Architecture
          </h2>
          <p className="mt-4 text-[#0077BE] font-semibold text-sm tracking-wider uppercase">
            A comprehensive look at the underlying deep learning layers
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Card Left: CNN-ViT Metrics */}
          <div className="bg-[#F4F1EA] dark:bg-slate-900/40 border border-slate-200/80 dark:border-slate-800/80 rounded-3xl p-8 md:p-10 flex flex-col justify-between hover:bg-[#FDFBF7] dark:hover:bg-slate-900/60 transition-all hover:shadow-lg duration-300 group">
            <div>
              <div className="p-3 bg-[#3CC4DB]/10 rounded-2xl w-fit text-[#3CC4DB] mb-6">
                <Cpu className="w-6 h-6" />
              </div>
              <h3 className="font-serif text-2xl font-bold text-slate-900 dark:text-slate-100 group-hover:text-[#0077BE] dark:group-hover:text-[#3CC4DB] transition-colors">
                CNN-ViT Hybrid Image Classifier
              </h3>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-4 leading-relaxed font-medium">
                Combines local convolutional features (excellent at capturing GAN frequency anomalies and pixel boundary artifacts) with global Vision Transformer attention maps (which identify global structural inconsistencies in generated faces).
              </p>
            </div>
            
            <div className="mt-10 p-4 border border-slate-200 dark:border-slate-800 bg-white/60 dark:bg-slate-900/60 rounded-2xl">
              <div className="flex justify-between items-center text-xs font-bold text-slate-500 dark:text-slate-400 mb-2 uppercase font-mono">
                <span>Features Resonation</span>
                <span className="text-[#0077BE]">Late-Fusion Link</span>
              </div>
              
              {/* Dynamic Resonation Graph SVG */}
              <div className="h-28 w-full flex items-end relative overflow-hidden">
                <svg viewBox="0 0 100 40" className="w-full h-full fill-none stroke-2">
                  {/* CNN Line */}
                  <motion.path
                    d="M 0,35 Q 25,5 50,30 T 100,10"
                    stroke="#0077BE"
                    strokeWidth="2"
                    initial={{ pathLength: 0 }}
                    whileInView={{ pathLength: 1 }}
                    transition={{ duration: 2.5, ease: "easeInOut" }}
                  />
                  {/* ViT Line */}
                  <motion.path
                    d="M 0,25 Q 35,38 70,12 T 100,5"
                    stroke="#3CC4DB"
                    strokeWidth="1.5"
                    strokeDasharray="2 2"
                    initial={{ pathLength: 0 }}
                    whileInView={{ pathLength: 1 }}
                    transition={{ duration: 2.5, ease: "easeInOut", delay: 0.3 }}
                  />
                </svg>
                <div className="absolute bottom-1 right-1 text-[8px] font-mono text-[#DC143C] font-semibold bg-[#DC143C]/10 px-1.5 py-0.5 rounded">
                  F1-Score // 96.4%
                </div>
              </div>
            </div>
          </div>

          {/* Card Center: Inference Target */}
          <div id="inference-clock-trigger" className="bg-[#F4F1EA] dark:bg-slate-900/40 border border-slate-200/80 dark:border-slate-800/80 rounded-3xl p-8 md:p-10 flex flex-col justify-between hover:bg-[#FDFBF7] dark:hover:bg-slate-900/60 transition-all hover:shadow-lg duration-300 group">
            <div>
              <div className="p-3 bg-[#DC143C]/10 rounded-2xl w-fit text-[#DC143C] mb-6">
                <Clock className="w-6 h-6" />
              </div>
              <h3 className="font-serif text-2xl font-bold text-slate-900 dark:text-slate-100 group-hover:text-[#DC143C] transition-colors">
                Sub-2-Second Live Target
              </h3>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-4 leading-relaxed font-medium">
                Optimized with DistilBERT-Tagalog model compression and server-assisted inference pipelines. Real-time media feeds are scanned directly at the client browser level without causing significant rendering lag.
              </p>
            </div>

            <div className="mt-10 flex flex-col items-center justify-center p-6 border border-slate-200 dark:border-slate-800 bg-white/60 dark:bg-slate-900/60 rounded-2xl text-center relative overflow-hidden">
              <span className="text-[10px] font-mono font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-1">
                Measured Inference Latency
              </span>
              <div className="text-6xl md:text-7xl font-extralight font-serif tracking-tight text-slate-900 dark:text-slate-50 tabular-nums my-2 border-b-2 border-[#3CC4DB] pb-1">
                {clockInference}<span className="text-xl md:text-2xl text-slate-400 font-sans ml-1">ms</span>
              </div>
              <span className="text-[10px] font-mono font-bold text-[#DC143C] bg-[#DC143C]/10 px-3 py-1 rounded-full uppercase mt-2">
                Under 2.0s Threshold
              </span>
            </div>
          </div>

          {/* Card Right: Filmstrip Timeline */}
          <div className="bg-[#F4F1EA] dark:bg-slate-900/40 border border-slate-200/80 dark:border-slate-800/80 rounded-3xl p-8 md:p-10 flex flex-col justify-between hover:bg-[#FDFBF7] dark:hover:bg-slate-900/60 transition-all hover:shadow-lg duration-300 group overflow-hidden">
            <div>
              <div className="p-3 bg-[#0077BE]/10 rounded-2xl w-fit text-[#0077BE] mb-6">
                <Sliders className="w-6 h-6" />
              </div>
              <h3 className="font-serif text-2xl font-bold text-slate-900 dark:text-slate-100 group-hover:text-[#3CC4DB] transition-colors">
                Temporal Inconsistency Tracker
              </h3>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-4 leading-relaxed font-medium">
                Analyzes video sequences on a frame-by-frame basis to isolate temporal jitters, color space changes, and mouth-sound sync displacement. Essential for catching high-fidelity synthetic clips that appear perfect in static frames.
              </p>
            </div>

            <div className="mt-10">
              <span className="text-[10px] font-mono font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest block mb-3">
                Frame Strip scrubbing (Pixel & Lip anomalies)
              </span>
              
              <div className="flex gap-2.5 overflow-x-auto pb-2 hide-scrollbar">
                {[
                  { frame: 1, flag: false, time: "0.0s" },
                  { frame: 2, flag: false, time: "0.2s" },
                  { frame: 3, flag: true, type: "Mouth-Sync", time: "0.4s" },
                  { frame: 4, flag: false, time: "0.6s" },
                  { frame: 5, flag: true, type: "Pixel Jitter", time: "0.8s" },
                  { frame: 6, flag: false, time: "1.0s" },
                ].map((item, index) => (
                  <div 
                    key={index}
                    className={`relative w-20 flex-shrink-0 aspect-[4/5] rounded-xl border dark:border-slate-800 overflow-hidden p-0.5 transition-all duration-300 ${
                      item.flag ? "border-[#DC143C] bg-[#DC143C]/5 dark:bg-[#DC143C]/10 shadow-md shadow-[#DC143C]/10 scale-95" : "border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"
                    }`}
                  >
                    <div className="w-full h-full bg-slate-200/60 dark:bg-slate-950/60 rounded-lg relative overflow-hidden flex flex-col items-center justify-center">
                      {/* Stylized wireframe face shape */}
                      <svg viewBox="0 0 40 50" className="w-10 h-10 fill-none stroke-1 stroke-slate-400 dark:stroke-slate-600">
                        <ellipse cx="20" cy="22" rx="12" ry="16" />
                        <circle cx="16" cy="18" r="2" />
                        <circle cx="24" cy="18" r="2" />
                        <path d="M15,32 Q20,38 25,32" stroke={item.flag ? "#DC143C" : "#64748B"} />
                      </svg>

                      {item.flag && (
                        <div className="absolute inset-0 bg-[#DC143C]/10 border border-[#DC143C]/40 animate-pulse flex flex-col justify-between p-1">
                          <span className="text-[6px] font-mono text-[#DC143C] font-bold tracking-tight bg-white/80 px-0.5 rounded leading-none w-fit">
                            {item.type}
                          </span>
                          <span className="text-[7px] font-mono text-[#DC143C] font-bold text-center">
                            ANOMALY
                          </span>
                        </div>
                      )}
                    </div>
                    <span className="absolute bottom-1 right-2 text-[8px] font-mono font-bold text-slate-400 bg-slate-100/90 px-1 rounded-sm">
                      {item.time}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

        </div>
      </section>

      {/* 5. INTERACTIVE LIVE DEMO WORKSPACE */}
      <section 
        id="demo" 
        onDragOver={handleGlobalDragOver}
        onDragLeave={handleGlobalDragLeave}
        onDrop={handleGlobalDrop}
        className={`py-24 border-b border-slate-200/60 dark:border-slate-800/60 px-6 transition-colors duration-300 ${
          isDraggingOver ? "bg-[#3CC4DB]/5 dark:bg-[#3CC4DB]/10" : "bg-[#F8F6F0] dark:bg-slate-950"
        }`}
      >
        <div className="max-w-6xl mx-auto bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 md:p-10 shadow-md dark:shadow-[0_12px_40px_rgba(0,0,0,0.3)]">
          <div className="text-center mb-10">
            <h2 className="font-serif text-3xl md:text-4xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
              PRISM Forensics Workspace
            </h2>
            <p className="text-slate-500 dark:text-slate-400 text-sm mt-2 font-medium">
              Submit raw media text, photos, video clips, or social links to test our multimodal detection pipelines.
            </p>
            {isDraggingOver && (
              <div className="mt-3 text-xs font-mono font-bold text-[#0077BE] animate-bounce">
                Drop image or video file here to load instantly!
              </div>
            )}
          </div>

          {/* Two-Column Workspace Layout */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            
            {/* Left Column: Input Panel */}
            <div className="lg:col-span-6 space-y-6">
              
              {/* Tab Navigation */}
              <div className="flex flex-wrap gap-2 mb-6 border-b border-slate-200/60 dark:border-slate-800/60 pb-5">
                {[
                  { id: "text", label: "Text Anomaly", icon: FileText },
                  { id: "photo", label: "Photo Forensic", icon: Eye },
                  { id: "video", label: "Video Tracker", icon: Sliders },
                  { id: "url", label: "URL Inspector", icon: ExternalLink },
                ].map((tab) => {
                  const Icon = tab.icon;
                  const isActive = activeWorkspaceTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => {
                        setActiveWorkspaceTab(tab.id as "text" | "photo" | "video" | "url");
                        setDemoResult(null);
                      }}
                      className={`flex items-center gap-2 px-4 py-2.5 rounded-full text-xs font-bold transition-all cursor-pointer ${
                        isActive 
                          ? "bg-slate-950 dark:bg-slate-50 text-white dark:text-slate-950 shadow-sm" 
                          : "bg-[#F4F1EA] dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-[#eae6db] dark:hover:bg-slate-700"
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                      <span>{tab.label}</span>
                    </button>
                  );
                })}
              </div>

              <form onSubmit={handleDemoVerify} className="space-y-6">
                {activeWorkspaceTab === "text" && (
                  <div>
                    <label className="block text-xs font-mono font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2">
                      Social Media Caption (Taglish supported)
                    </label>
                    <textarea 
                      value={demoText}
                      onChange={(e) => setDemoText(e.target.value)}
                      rows={3}
                      className="w-full bg-[#F8F6F0] dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 text-slate-950 dark:text-slate-50 placeholder-slate-400 dark:placeholder-slate-600 font-semibold focus:outline-none focus:border-[#3CC4DB] transition-all"
                      placeholder="Paste news captions or social posts here..."
                    />
                    <div className="flex flex-wrap gap-2 mt-3">
                      <button 
                        type="button"
                        onClick={() => setDemoText("Sabi sa Twitter, cancelled raw ang klase sa buong bansa bukas gawa ng malaking bagyo na paparating. Legit ba?")}
                        className="text-[10px] font-bold text-slate-500 dark:text-slate-400 hover:text-[#0077BE] dark:hover:text-[#3CC4DB] border border-slate-200 dark:border-slate-800 px-3 py-1.5 rounded-full transition-colors cursor-pointer"
                      >
                        Load Taglish News
                      </button>
                      <button 
                        type="button"
                        onClick={() => setDemoText("Grabe! Panuorin niyo ito, may inamin ang opisyal sa leak na ginawa gamit ang AI synthetic program.")}
                        className="text-[10px] font-bold text-slate-500 dark:text-slate-400 hover:text-[#0077BE] dark:hover:text-[#3CC4DB] border border-slate-200 dark:border-slate-800 px-3 py-1.5 rounded-full transition-colors cursor-pointer"
                      >
                        Load AI Leak Text
                      </button>
                    </div>
                  </div>
                )}

                {activeWorkspaceTab === "photo" && (
                  <div className="space-y-4">
                    <label className="block text-xs font-mono font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">
                      Photo Upload & Verification
                    </label>
                    
                    {/* Drag-and-drop zone */}
                    <div className="border-2 border-dashed border-slate-200 dark:border-slate-800 bg-[#F8F6F0] dark:bg-slate-950 rounded-2xl p-6 flex flex-col items-center justify-center text-center hover:border-[#3CC4DB] transition-all relative overflow-hidden min-h-[160px]">
                      {selectedPhotoSample ? (
                        <div className="flex items-center gap-4 text-left w-full h-full relative z-10 p-2">
                          <img src={selectedPhotoSample.url} className="h-28 w-24 object-cover rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm" alt="Selected Preview" />
                          <div>
                            <div className="font-bold text-slate-800 dark:text-slate-200 text-sm">{selectedPhotoSample.name}</div>
                            <div className="text-[10px] text-slate-400 dark:text-slate-500 font-mono mt-0.5">{selectedPhotoSample.anomaly}</div>
                            <div className="text-[10px] text-[#DC143C] font-mono font-bold mt-1">Ready to scan // Click Run Forensic Scan</div>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <Eye className="w-8 h-8 text-slate-400 dark:text-slate-500 mx-auto" />
                          <div className="text-xs font-bold text-slate-600 dark:text-slate-400">Drag & drop photo here or click to browse</div>
                          <div className="text-[10px] text-slate-400 dark:text-slate-500 font-medium">Supports JPG, PNG, WebP up to 10MB</div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {activeWorkspaceTab === "video" && (
                  <div className="space-y-4">
                    <label className="block text-xs font-mono font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">
                      Video Timeline Tracker
                    </label>
                    
                    {/* Drag-and-drop zone */}
                    <div className="border-2 border-dashed border-slate-200 dark:border-slate-800 bg-[#F8F6F0] dark:bg-slate-950 rounded-2xl p-6 flex flex-col items-center justify-center text-center hover:border-[#3CC4DB] transition-all relative overflow-hidden min-h-[160px]">
                      <div className="space-y-2">
                        <Sliders className="w-8 h-8 text-slate-400 dark:text-slate-500 mx-auto" />
                        <div className="text-xs font-bold text-slate-600 dark:text-slate-400">Drag & drop MP4/WebM video here or click to browse</div>
                        <div className="text-[10px] text-slate-400 dark:text-slate-500 font-medium">Scans for Lip-Sync Gaps & Boundary Jitters</div>
                      </div>
                    </div>
                  </div>
                )}

                {activeWorkspaceTab === "url" && (
                  <div className="space-y-4">
                    <label className="block text-xs font-mono font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">
                      Web URL Scanner (Social Media Link)
                    </label>
                    <div className="relative flex items-center">
                      <ExternalLink className="absolute left-4 w-4 h-4 text-slate-400 dark:text-slate-500" />
                      <input 
                        type="text" 
                        value={demoUrl}
                        onChange={(e) => setDemoUrl(e.target.value)}
                        placeholder="https://facebook.com/watch/post_id_91823..." 
                        className="w-full bg-[#F8F6F0] dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-full pl-11 pr-6 py-3.5 text-slate-900 dark:text-slate-50 focus:outline-none focus:border-[#3CC4DB] transition-all font-semibold text-sm" 
                      />
                    </div>
                  </div>
                )}

                <div className="flex justify-end pt-2">
                  <button 
                    type="submit" 
                    disabled={demoLoading}
                    className="px-8 py-3 bg-[#0077BE] hover:bg-[#005a92] disabled:bg-slate-400 text-white font-bold text-sm rounded-full inline-flex items-center gap-2 shadow-sm transition-all transform hover:-translate-y-0.5 cursor-pointer"
                  >
                    {demoLoading ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        <span>Deep Scanning Anomaly...</span>
                      </>
                    ) : (
                      <>
                        <Search className="w-4 h-4" />
                        <span>Run Forensic Scan</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>

            {/* Right Column: Scan Diagnostics & Results */}
            <div className="lg:col-span-6 w-full">
              <AnimatePresence mode="wait">
                {demoResult ? (
                  <motion.div 
                    key="results"
                    initial={{ opacity: 0, y: 15 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 15 }}
                    className="bg-slate-50 dark:bg-slate-900/30 border border-slate-200/60 dark:border-slate-800/60 rounded-3xl p-6 md:p-8 flex flex-col gap-6 text-left min-h-[460px] w-full"
                  >
                    {/* Stats Header Row: 3 columns */}
                    <div className="grid grid-cols-3 gap-3 w-full">
                      {/* Stat 1: Verdict */}
                      <div className="bg-white dark:bg-slate-950 p-4 rounded-2xl border border-slate-200/60 dark:border-slate-850 shadow-sm flex flex-col justify-between min-h-[120px]">
                        <div className="flex justify-between items-start w-full gap-2">
                          <span className="text-[9px] sm:text-[10px] font-mono font-bold text-slate-400 uppercase tracking-widest truncate">
                            Verdict
                          </span>
                          <div className={`p-1.5 rounded-lg shrink-0 ${demoResult.verdict === "HIGH RISK" ? "bg-[#DC143C]/10 text-[#DC143C]" : "bg-green-100 text-green-700"}`}>
                            {demoResult.verdict === "HIGH RISK" ? <AlertTriangle className="w-4 h-4" /> : <CheckCircle className="w-4 h-4" />}
                          </div>
                        </div>
                        <div className="mt-2">
                          <span className={`text-sm sm:text-lg font-black ${demoResult.verdict === "HIGH RISK" ? "text-[#DC143C]" : "text-green-600"} tracking-tight block`}>
                            {demoResult.verdict}
                          </span>
                        </div>
                      </div>

                      {/* Stat 2: Confidence */}
                      <div className="bg-white dark:bg-slate-950 p-4 rounded-2xl border border-slate-200/60 dark:border-slate-850 shadow-sm flex flex-col justify-between min-h-[120px] flex-1">
                        <div className="flex justify-between items-start w-full gap-2">
                          <span className="text-[9px] sm:text-[10px] font-mono font-bold text-slate-400 uppercase tracking-widest truncate">
                            Confidence
                          </span>
                          <div className="p-1.5 rounded-lg bg-blue-50 text-[#0077BE] shrink-0">
                            <Activity className="w-4 h-4" />
                          </div>
                        </div>
                        <div className="mt-2 w-full">
                          <span className="text-sm sm:text-lg font-bold text-slate-800 dark:text-slate-200 tabular-nums block">
                            {demoResult.confidence}%
                          </span>
                          <div className="w-full bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full mt-1.5 overflow-hidden">
                            <div 
                              className={`h-full rounded-full ${demoResult.verdict === "HIGH RISK" ? "bg-[#DC143C]" : "bg-green-500"}`}
                              style={{ width: `${demoResult.confidence}%` }}
                            />
                          </div>
                        </div>
                      </div>

                      {/* Stat 3: Inference Time */}
                      <div className="bg-white dark:bg-slate-950 p-4 rounded-2xl border border-slate-200/60 dark:border-slate-850 shadow-sm flex flex-col justify-between min-h-[120px]">
                        <div className="flex justify-between items-start w-full gap-2">
                          <span className="text-[9px] sm:text-[10px] font-mono font-bold text-slate-400 uppercase tracking-widest truncate">
                            Inference
                          </span>
                          <div className="p-1.5 rounded-lg bg-purple-50 text-purple-600 shrink-0">
                            <Clock className="w-4 h-4" />
                          </div>
                        </div>
                        <div className="mt-2">
                          <span className="text-sm sm:text-lg font-mono font-bold text-slate-800 dark:text-slate-200 tabular-nums block">
                            {demoResult.metrics.latency}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Explanations & Visualizations container */}
                    <div className="w-full flex-1 flex flex-col justify-center border-t border-slate-200/60 dark:border-slate-800/60 pt-6">
                      {/* Contextual Visualizations based on input type */}
                      {demoResult.metrics.type === "text" && (
                        <div className="space-y-4">
                          <div>
                            <h4 className="text-xs font-mono font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2">
                              LIME Text Highlighting (Explainable Reason Parser)
                            </h4>
                            <div className="p-4 bg-white dark:bg-slate-950 rounded-2xl border border-slate-200/80 dark:border-slate-800/80 font-medium text-slate-800 dark:text-slate-200 leading-relaxed text-sm max-h-[200px] overflow-y-auto">
                              {demoResult.metrics.limeHighlight?.map((word, i) => (
                                <span 
                                  key={i} 
                                  className={word.flag ? "bg-[#DC143C]/20 text-[#DC143C] font-semibold border-b border-[#DC143C] px-1 rounded-sm shadow-sm" : ""}
                                >
                                  {word.text}
                                </span>
                              ))}
                            </div>
                            <span className="text-[9px] text-slate-500 dark:text-slate-400 font-medium mt-2 block italic leading-snug">
                              Highlighted sections represent token-sequences carrying high statistical weights for the synthetic content classifier.
                            </span>
                          </div>
                        </div>
                      )}

                      {demoResult.metrics.type === "photo" && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
                          {/* Visual CAM Heatmap Overlay */}
                          <div className="relative aspect-square w-full bg-slate-100 dark:bg-slate-950 rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-800 shadow-inner group">
                            <img src={demoResult.metrics.url || undefined} className="w-full h-full object-cover" alt="Scanned Target" />
                            
                            {/* Laser scanner effect */}
                            <div className="absolute inset-x-0 h-0.5 bg-[#3CC4DB] shadow-[0_0_12px_rgba(60,196,219,0.8)] animate-bounce z-20" style={{ top: "35%", animationDuration: "3s" }} />
                            
                            {/* Bounding box around anomaly */}
                            <div 
                              style={{
                                top: demoResult.metrics.camRegion?.top,
                                left: demoResult.metrics.camRegion?.left,
                                width: demoResult.metrics.camRegion?.width,
                                height: demoResult.metrics.camRegion?.height,
                              }}
                              className="absolute border-2 border-dashed border-[#DC143C] z-10 rounded-full bg-radial from-[#DC143C]/40 via-transparent to-transparent animate-pulse"
                            />

                            <span className="absolute bottom-3 left-3 bg-[#DC143C] text-white text-[8px] font-mono font-bold tracking-widest px-2 py-0.5 rounded shadow">
                              CAM FLAG // LOCAL ANOMALY
                            </span>
                          </div>

                          {/* Metrics Checklist */}
                          <div className="space-y-3">
                            <h4 className="text-xs font-mono font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">
                              CNN-ViT Diagnostic Metrics
                            </h4>
                            <div className="space-y-1.5">
                              {[
                                { label: "Generative Grid Resonation", val: "91.2%", alert: true },
                                { label: "Iris Reflection Coherence", val: "Asymmetric", alert: true },
                                { label: "Boundary Alignment", val: "Failed", alert: true },
                                { label: "Color Space Dist.", val: "Normal", alert: false },
                              ].map((m, idx) => (
                                <div key={idx} className="flex justify-between items-center p-2 bg-white dark:bg-slate-950 border border-slate-200/60 dark:border-slate-850 rounded-xl">
                                  <span className="text-[10px] font-bold text-slate-700 dark:text-slate-300">{m.label}</span>
                                  <span className={`text-[8px] font-mono font-bold px-1.5 py-0.5 rounded ${m.alert ? "bg-[#DC143C]/10 text-[#DC143C]" : "bg-green-100 text-green-700"}`}>
                                    {m.val}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}

                      {demoResult.metrics.type === "video" && (
                        <div className="space-y-4">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
                            {/* Simulated Video Player */}
                            <div className="relative aspect-video bg-slate-950 rounded-2xl overflow-hidden border border-slate-800 shadow-xl flex items-center justify-center text-slate-400">
                              <Sliders className="w-10 h-10 text-[#DC143C] animate-pulse" />
                              <span className="absolute bottom-3 left-3 bg-black/60 backdrop-blur text-white text-[8px] font-mono px-2 py-1 rounded">
                                SAMPLE_FEED_SCAN.mp4
                              </span>
                            </div>

                            {/* Video Diagnostics */}
                            <div className="space-y-2">
                              <h4 className="text-xs font-mono font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">
                                Temporal Forensics
                              </h4>
                              
                              <div className="p-3 bg-white dark:bg-slate-950 rounded-2xl border border-slate-200/60 dark:border-slate-850 space-y-1.5">
                                <div className="flex justify-between text-[10px] font-bold text-slate-700 dark:text-slate-300">
                                  <span>Lip-Sync Audio Align:</span>
                                  <span className="text-[#DC143C] font-mono font-black">{demoResult.metrics.syncGap} Gap</span>
                                </div>
                                <div className="flex justify-between text-[10px] font-bold text-slate-700 dark:text-slate-300 border-t border-slate-200/60 dark:border-slate-850 pt-1.5">
                                  <span>Frame Drift Coeff:</span>
                                  <span className="text-[#DC143C] font-mono font-bold">0.89 Anomaly</span>
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* Timeline Scrubber */}
                          <div>
                            <span className="text-[9px] font-mono font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest block mb-1">
                              Timeline Flagged Frames Tracker
                            </span>
                            <div className="h-3.5 bg-slate-200 dark:bg-slate-950 rounded-full overflow-hidden flex relative border border-slate-200 dark:border-slate-850 shadow-inner">
                              <div className="absolute top-0 bottom-0 left-[30%] w-[3%] bg-[#DC143C] animate-pulse" />
                              <div className="absolute top-0 bottom-0 left-[50%] w-[2%] bg-[#DC143C] animate-pulse" />
                              <div className="absolute top-0 bottom-0 left-[75%] w-[4%] bg-[#DC143C] animate-pulse" />
                              <span className="absolute right-2 top-0.5 text-[8px] font-mono font-bold text-slate-500 dark:text-slate-400">Anomaly Frames: 3, 5, 7</span>
                            </div>
                          </div>
                        </div>
                      )}

                      {demoResult.metrics.type === "url" && (
                        <div className="space-y-4">
                          <div className="p-4 bg-white dark:bg-slate-950 rounded-2xl border border-slate-200/60 dark:border-slate-850 grid grid-cols-3 gap-2 text-center shadow-sm">
                            <div>
                              <span className="text-[9px] font-mono font-bold text-slate-400 uppercase tracking-widest block">Domain Rep</span>
                              <span className={`text-[10px] font-bold block mt-1 ${demoResult.metrics.integrity === "PASSED" ? "text-green-600" : "text-[#DC143C]"}`}>{demoResult.metrics.domainReputation?.split(" ")[0]}</span>
                            </div>
                            <div>
                              <span className="text-[9px] font-mono font-bold text-slate-400 uppercase tracking-widest block">Integrity Checks</span>
                              <span className={`text-[10px] font-black block mt-1 ${demoResult.metrics.integrity === "PASSED" ? "text-green-600" : "text-[#DC143C]"}`}>{demoResult.metrics.integrity}</span>
                            </div>
                            <div>
                              <span className="text-[9px] font-mono font-bold text-slate-400 uppercase tracking-widest block">Classification Score</span>
                              <span className="text-[10px] font-bold text-slate-800 block mt-1 tabular-nums">{demoResult.confidence}%</span>
                            </div>
                          </div>
                          
                          <div>
                            <h4 className="text-xs font-mono font-bold text-slate-500 uppercase tracking-widest mb-2">
                              Late-Fusion Metadata Auditing
                            </h4>
                            <div className="p-3 bg-slate-950 text-slate-300 font-mono text-[9px] rounded-2xl border border-slate-800 space-y-1 max-h-[120px] overflow-y-auto">
                              {demoResult.metrics.details?.map((item: string, idx: number) => (
                                <div key={idx} className="flex gap-2">
                                  <span className="text-slate-500">&gt;</span>
                                  <span>{item}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </motion.div>
                ) : (
                  <motion.div
                    key="standby"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="bg-slate-50 dark:bg-slate-900/30 border-2 border-dashed border-slate-200/80 dark:border-slate-800/80 rounded-3xl p-8 min-h-[460px] flex flex-col items-center justify-center text-center space-y-6 relative overflow-hidden"
                  >
                    {/* Ambient radar sweep */}
                    <div className="w-40 h-40 rounded-full border border-slate-200 dark:border-slate-800 flex items-center justify-center relative bg-white dark:bg-slate-950 shadow-sm">
                      <div className="absolute inset-0 rounded-full border-t border-slate-400/30 dark:border-slate-600/30 animate-spin" style={{ animationDuration: "6s" }} />
                      <div className="absolute inset-2 rounded-full border border-dashed border-slate-100 dark:border-slate-900" />
                      <div className="absolute inset-8 rounded-full border border-slate-200 dark:border-slate-800 flex items-center justify-center bg-slate-50 dark:bg-slate-900">
                        <Search className="w-8 h-8 text-slate-400 dark:text-slate-500 animate-pulse" />
                      </div>
                    </div>
                    <div className="space-y-1.5 z-10">
                      <h3 className="font-bold text-slate-800 dark:text-slate-200 text-sm">Forensic Core Standby</h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400 font-medium max-w-[240px]">
                        Drag-and-drop files directly here, or select inputs on the left to activate scanning pipelines.
                      </p>
                    </div>
                    
                    {/* Grid scanning effect */}
                    <div className="absolute inset-0 bg-[linear-gradient(to_right,#3CC4DB05_1px,transparent_1px),linear-gradient(to_bottom,#3CC4DB05_1px,transparent_1px)] bg-[size:16px_16px] pointer-events-none" />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

          </div>
        </div>
      </section>

      {/* 6. PLATFORM CAROUSEL MARQUEE (00:07 - 00:14) */}
      <section className="py-6 border-y border-slate-200/60 dark:border-slate-850 bg-[#F4F1EA]/50 dark:bg-slate-900/50 overflow-hidden relative">
        {/* Continuous Marquee Banner */}
        <div className="flex whitespace-nowrap overflow-hidden py-2 pointer-events-none select-none font-bold text-2xl text-slate-300 dark:text-slate-700 uppercase tracking-widest">
          <motion.div 
            animate={{ x: ["0%", "-50%"] }}
            transition={{ ease: "linear", duration: 30, repeat: Infinity }}
            className="flex gap-20"
          >
            <span>AI Synthesis Mitigation</span> <span className="text-[#0077BE]">•</span>
            <span>Temporal Forensics</span> <span className="text-[#3CC4DB]">•</span>
            <span>Cross-Modal Synthesis</span> <span className="text-[#0077BE]">•</span>
            <span>Live Disinformation Scanning</span> <span className="text-[#3CC4DB]">•</span>
            <span>Taglish BERT Parser</span> <span className="text-[#0077BE]">•</span>
            <span>CNN-ViT Fusion Network</span> <span className="text-[#3CC4DB]">•</span>

            {/* Repeated for loop compatibility */}
            <span>AI Synthesis Mitigation</span> <span className="text-[#0077BE]">•</span>
            <span>Temporal Forensics</span> <span className="text-[#3CC4DB]">•</span>
            <span>Cross-Modal Synthesis</span> <span className="text-[#0077BE]">•</span>
            <span>Live Disinformation Scanning</span> <span className="text-[#3CC4DB]">•</span>
            <span>Taglish BERT Parser</span> <span className="text-[#0077BE]">•</span>
            <span>CNN-ViT Fusion Network</span> <span className="text-[#3CC4DB]">•</span>
          </motion.div>
        </div>
      </section>

      {/* 7. CHROME EXTENSION UTILITY PORTAL */}
      <section id="extension" className="py-28 px-6 bg-white dark:bg-slate-950 border-b border-slate-200/60 dark:border-slate-850 text-left">
        <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
          
          <div className="lg:col-span-5 space-y-6">
            <span className="text-xs font-mono font-bold text-[#0077BE] uppercase tracking-widest border border-[#0077BE]/30 px-3 py-1 rounded-full bg-[#0077BE]/5">
              Client Protection Layer
            </span>
            <h2 className="font-serif text-4xl md:text-5xl font-extrabold tracking-tight text-slate-900 dark:text-slate-50 leading-tight">
              The PRISM Passive Shield Browser Extension
            </h2>
            <p className="text-slate-600 dark:text-slate-400 font-medium leading-relaxed">
              Integrate passive, local-level safety directly inside your Chrome browser. PRISM operates silently in the background on social media networks (Facebook, TikTok, and X), running real-time late-fusion validation tags on items in your active scroll views.
            </p>

            <div className="flex border-b border-slate-200 dark:border-slate-850 pb-2 gap-4">
              <button 
                onClick={() => setSelectedExtensionTab("passive")}
                className={`text-xs font-bold uppercase tracking-wider pb-2 transition-all ${
                  selectedExtensionTab === "passive" ? "border-b-2 border-[#0077BE] text-[#0077BE]" : "text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-350"
                }`}
              >
                Passive Flagging
              </button>
              <button 
                onClick={() => setSelectedExtensionTab("verdict")}
                className={`text-xs font-bold uppercase tracking-wider pb-2 transition-all ${
                  selectedExtensionTab === "verdict" ? "border-b-2 border-[#0077BE] text-[#0077BE]" : "text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-350"
                }`}
              >
                Explainable HUD
              </button>
              <button 
                onClick={() => setSelectedExtensionTab("manifest")}
                className={`text-xs font-bold uppercase tracking-wider pb-2 transition-all ${
                  selectedExtensionTab === "manifest" ? "border-b-2 border-[#0077BE] text-[#0077BE]" : "text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-350"
                }`}
              >
                Manifest V3 Privacy
              </button>
            </div>

            <div className="text-sm font-medium text-slate-600 dark:text-slate-400 leading-relaxed min-h-[100px]">
              {selectedExtensionTab === "passive" && (
                <p>No user action required. As social feeds reload dynamically, visual and text assets are intercepted, and forensic indicators appear alongside feed objects within milliseconds.</p>
              )}
              {selectedExtensionTab === "verdict" && (
                <p>Hover over flagged posts to expand our explainability Head-Up Display (HUD). Check the LIME highlighted phrase models and CAM visual mesh mappings instantly.</p>
              )}
              {selectedExtensionTab === "manifest" && (
                <p>Fully compliant with Chrome&apos;s Manifest V3 standards. All scripts run in sandboxed contexts without access to your credentials or persistent browsing databases, protecting user privacy.</p>
              )}
            </div>

            <div className="flex flex-col sm:flex-row gap-4 pt-4">
              <a 
                href="#download"
                className="px-6 py-3.5 bg-[#DC143C] hover:bg-[#b01030] text-[#FDFBF7] font-bold text-sm rounded-full inline-flex items-center gap-2 justify-center shadow-md transform hover:-translate-y-0.5 transition-all"
              >
                <Download className="w-4 h-4" />
                <span>Add to Chrome (Free)</span>
              </a>
              <a 
                href="/prism.pdf" 
                download
                className="px-6 py-3.5 border border-slate-200 dark:border-slate-850 hover:border-slate-350 dark:hover:border-slate-700 text-slate-700 dark:text-slate-300 font-bold text-sm rounded-full inline-flex items-center gap-2 justify-center transition-all"
              >
                <span>Read Architecture Review</span>
                <ChevronRight className="w-4 h-4 text-[#0077BE]" />
              </a>
            </div>
          </div>

          {/* Chrome Extension UI Mockup Grid */}
          <div className="lg:col-span-7 bg-[#F8F6F0] dark:bg-slate-900/50 p-6 rounded-3xl border border-slate-200/80 dark:border-slate-850 relative">
            <div className="bg-slate-950 rounded-2xl overflow-hidden shadow-2xl border border-slate-800">
              
              {/* Mock Browser Header */}
              <div className="bg-slate-900 dark:bg-slate-950 py-3 px-4 flex items-center justify-between border-b border-slate-800 dark:border-slate-900">
                <div className="flex gap-1.5">
                  <div className="w-3 h-3 rounded-full bg-slate-700" />
                  <div className="w-3 h-3 rounded-full bg-slate-700" />
                  <div className="w-3 h-3 rounded-full bg-slate-700" />
                </div>
                <div className="bg-slate-950 text-slate-400 text-[10px] font-mono px-6 py-1 rounded w-60 text-center truncate">
                  https://facebook.com/feed/post_4918230
                </div>
                <div className="w-5" />
              </div>

              {/* Mock Social Feed Post with PRISM active extension shield */}
              <div className="bg-slate-950 dark:bg-slate-900 p-6 space-y-4 text-left">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-slate-800" />
                  <div>
                    <div className="w-28 h-3.5 bg-slate-800 rounded" />
                    <div className="w-16 h-2 bg-slate-800 rounded mt-1.5" />
                  </div>
                </div>

                <div className="space-y-2 text-sm text-slate-300 dark:text-slate-400 font-light">
                  <p>Breaking: <span className="bg-[#DC143C]/20 border-b border-[#DC143C] px-1 rounded-sm text-[#DC143C]">Artificial synthetic clip</span> shows official acknowledging deep manipulation anomalies. Panoorin niyo!</p>
                </div>

                {/* Simulated Facebook/Twitter image post with PRISM highlight */}
                <div className="relative aspect-video rounded-xl bg-slate-900 dark:bg-slate-950 border border-slate-800 dark:border-slate-900 overflow-hidden">
                  <img src="https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&q=80&w=400" className="w-full h-full object-cover filter blur-[2px]" alt="Sample media" />
                  
                  {/* Extension active indicator Overlay */}
                  <div className="absolute inset-0 bg-slate-950/70 dark:bg-slate-900/70 flex flex-col justify-between p-4 border border-[#DC143C]/60 rounded-xl">
                    <div className="flex justify-between items-start">
                      <span className="bg-[#DC143C] text-[#FDFBF7] text-[9px] font-mono font-bold tracking-widest px-2 py-0.5 rounded-full inline-flex items-center gap-1 shadow-sm">
                        <AlertTriangle className="w-3 h-3" />
                        <span>PRISM: SYNTHETIC ANOMALY DETECTED</span>
                      </span>
                      <span className="text-[#3CC4DB] text-[10px] font-mono font-semibold">
                        LATE FUSION // PASSIVE SHIELD
                      </span>
                    </div>

                    {/* Miniature CAM mesh visualization */}
                    <div className="flex justify-between items-end border-t border-slate-850 pt-2.5">
                      <div className="space-y-1">
                        <div className="text-[10px] font-mono text-slate-300 font-bold">
                          ViT CNN Combined: <span className="text-[#DC143C]">96.8% Confidence</span>
                        </div>
                        <div className="text-[8px] font-mono text-slate-400">
                          ANOMALY: Spatial boundary displacement around facial coordinates
                        </div>
                      </div>
                      <button className="px-3 py-1.5 bg-slate-900 hover:bg-slate-850 border border-slate-700/80 text-[10px] font-mono font-bold rounded text-[#3CC4DB] transition-colors">
                        View CAM Mesh
                      </button>
                    </div>
                  </div>
                </div>

              </div>

            </div>
          </div>

        </div>
      </section>

      {/* 8. PUBLICATIONS & ACADEMIC DOCUMENTATION */}
      <section id="publications" className="py-24 bg-[#F8F6F0] dark:bg-slate-950 px-6 transition-colors duration-300">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="font-serif text-3xl md:text-5xl font-extrabold tracking-tight text-slate-900 dark:text-slate-50">
              Academic Foundations
            </h2>
            <p className="text-[#0077BE] dark:text-[#3CC4DB] font-semibold text-sm tracking-wider uppercase mt-2">
              Research Context & Literature Benchmarking
            </p>
          </div>

          <div className="space-y-8">
            {[
              {
                title: "PRISM: A Multimodal Deep Learning System for Progressive Real-Time Identification of Synthetic Media and Disinformation on Social Media Platforms",
                journal: "PRISM Technical Report 2026 // Research Consortium",
                authors: "Lance Adrian D. Acal, Jericho G. Delos Reyes, Lee Adrian D. Noroña, Christian B. Valenzuela",
                desc: "This paper outlines the technical and conceptual framework of PRISM. Discusses the localized Taglish DistilBERT implementation alongside the CNN-ViT late-fusion visual analysis to bridge the gap between deep learning forensics and social media users."
              }
            ].map((pub, idx) => (
              <div key={idx} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800/80 rounded-3xl p-8 hover:shadow-lg transition-shadow duration-300">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                  <span className="px-3.5 py-1 bg-[#0077BE]/10 dark:bg-[#3CC4DB]/10 text-[#0077BE] dark:text-[#3CC4DB] text-[10px] font-mono font-bold rounded-full uppercase tracking-wider">
                    Core Reference // 0{idx + 1}
                  </span>
                  <span className="text-xs text-slate-500 dark:text-slate-400 font-bold font-mono">
                    {pub.journal}
                  </span>
                </div>
                <h3 className="font-serif text-xl md:text-2xl font-bold mt-4 text-slate-900 dark:text-slate-50 leading-tight">
                  {pub.title}
                </h3>
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mt-2">
                  Authors: {pub.authors}
                </p>
                <p className="text-sm text-slate-600 dark:text-slate-300 mt-4 leading-relaxed font-medium">
                  {pub.desc}
                </p>
                <div className="mt-6 flex justify-end">
                  <a 
                    href="/prism.pdf" 
                    download
                    className="inline-flex items-center gap-2 text-xs font-bold text-[#0077BE] dark:text-[#3CC4DB] hover:underline"
                  >
                    <span>Download Publication PDF</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 9. LENS FOCUS FOOTER (00:15 - 00:18 Framework Alignment) */}
      <motion.footer 
        ref={footerRef}
        style={{ 
          filter: footerBlur,
          opacity: footerOpacity
        }}
        className="relative flex flex-col justify-between overflow-hidden bg-[#FDFBF7] dark:bg-slate-950 py-16 px-6 md:px-12 border-t border-slate-200/60 dark:border-slate-850/60 transition-colors duration-300"
      >
        
        {/* Massive Low-Opacity Vector Mask Typography "PRISM" */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none overflow-hidden z-0">
          <h1 className="text-[28vw] font-black text-slate-900 dark:text-slate-50 opacity-[0.03] dark:opacity-[0.015] tracking-tighter leading-none select-none font-sans">
            PRISM
          </h1>
        </div>

        {/* Small spacer */}
        <div className="h-4" />

        {/* Interactive Contact & Inquiry Form Card */}
        <div className="relative z-10 w-full max-w-xl mx-auto bg-white/70 dark:bg-slate-900/70 backdrop-blur-xl border border-slate-200 dark:border-slate-800 p-8 md:p-10 shadow-2xl rounded-3xl text-center space-y-6 mb-8">
          <div className="space-y-2">
            <h3 className="font-serif text-3xl font-extrabold tracking-tight text-slate-900 dark:text-slate-50">
              Integrate Forensics Architecture
            </h3>
            <p className="text-sm text-slate-600 dark:text-slate-400 font-medium">
              Protect your platform feeds with multi-modal anomaly detection signals.
            </p>
          </div>

          <form onSubmit={(e) => e.preventDefault()} className="space-y-4">
            <div className="relative flex items-center">
              <User className="absolute left-4 w-4 h-4 text-slate-400 dark:text-slate-500" />
              <input 
                type="text" 
                placeholder="Full Name" 
                className="w-full bg-[#F4F1EA]/60 dark:bg-slate-950/60 text-slate-900 dark:text-slate-100 pl-11 pr-6 py-3.5 rounded-full border border-slate-200/80 dark:border-slate-800 focus:outline-none focus:border-[#3CC4DB] transition-all font-semibold text-sm" 
              />
            </div>
            <div className="relative flex items-center">
              <Mail className="absolute left-4 w-4 h-4 text-slate-400 dark:text-slate-500" />
              <input 
                type="email" 
                placeholder="Enterprise Work Email" 
                className="w-full bg-[#F4F1EA]/60 dark:bg-slate-950/60 text-slate-900 dark:text-slate-100 pl-11 pr-6 py-3.5 rounded-full border border-slate-200/80 dark:border-slate-800 focus:outline-none focus:border-[#3CC4DB] transition-all font-semibold text-sm" 
              />
            </div>
            
            <button className="w-full bg-[#0077BE] hover:bg-[#005a92] dark:bg-[#3CC4DB] dark:hover:bg-[#2cb2c9] dark:text-slate-950 text-[#FDFBF7] font-bold py-3.5 rounded-full transition-all shadow-md inline-flex items-center justify-center gap-2 transform hover:-translate-y-0.5 text-sm cursor-pointer">
              <span>Request Platform Demo / API Key</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>

          <span className="text-[10px] text-slate-400 dark:text-slate-500 font-mono font-bold tracking-widest block uppercase">
            LATENCY SECURE // SSL SECURED // PENDING PANEL REVIEW 2026
          </span>
        </div>

        {/* Footer Meta & Copyrights */}
        <div className="relative z-10 border-t border-slate-200/60 dark:border-slate-850/60 pt-8 flex flex-col md:flex-row justify-between items-center gap-4 text-xs font-semibold text-slate-500 dark:text-slate-400 max-w-6xl mx-auto w-full">
          <div className="flex flex-col items-center sm:flex-row sm:items-center gap-2 sm:gap-3 text-center sm:text-left">
            <div className="flex items-center gap-3">
              <svg viewBox="0 0 100 100" className="w-6 h-6 fill-none stroke-2">
                <polygon points="50,15 85,80 15,80" className="stroke-[#0077BE] dark:stroke-[#3CC4DB]" />
                <line x1="50" y1="15" x2="50" y2="80" className="stroke-[#3CC4DB]" />
              </svg>
              <span>© 2026 PRISM Research. All rights reserved.</span>
            </div>
            <span className="hidden sm:inline text-slate-300 dark:text-slate-700">|</span>
            <span className="text-[11px] font-mono text-[#0077BE] dark:text-[#3CC4DB] font-bold">Made by Code, Ano Tara?</span>
          </div>

          <div className="flex gap-6">
            <a href="#solutions" className="hover:text-slate-900 dark:hover:text-slate-100 transition-colors hover:underline">Synthetic Gallery</a>
            <a href="#bento" className="hover:text-slate-900 dark:hover:text-slate-100 transition-colors hover:underline">How It Works</a>
            <a href="/prism.pdf" download className="hover:text-slate-900 dark:hover:text-slate-100 transition-colors hover:underline">Research Paper</a>
          </div>
        </div>

      </motion.footer>

    </div>
  );
}
