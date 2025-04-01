var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// server/index.ts
import express2 from "express";

// server/routes.ts
import { createServer } from "http";

// shared/schema.ts
var schema_exports = {};
__export(schema_exports, {
  insertReadingGoalSchema: () => insertReadingGoalSchema,
  insertReadingLogSchema: () => insertReadingLogSchema,
  insertUserSchema: () => insertUserSchema,
  readingGoals: () => readingGoals,
  readingLogs: () => readingLogs,
  users: () => users
});
import { pgTable, text, serial, integer, boolean, date, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
var users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull()
});
var insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true
});
var readingLogs = pgTable("reading_logs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  date: date("date").notNull().defaultNow(),
  juzNumber: integer("juz_number").notNull(),
  pagesRead: integer("pages_read").notNull(),
  startPage: integer("start_page"),
  endPage: integer("end_page"),
  createdAt: timestamp("created_at").notNull().defaultNow()
});
var insertReadingLogSchema = createInsertSchema(readingLogs).pick({
  userId: true,
  date: true,
  juzNumber: true,
  pagesRead: true,
  startPage: true,
  endPage: true
});
var readingGoals = pgTable("reading_goals", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  totalPages: integer("total_pages").notNull().default(604),
  // Default total pages in Quran
  dailyTarget: integer("daily_target").notNull().default(5),
  weeklyTarget: integer("weekly_target").notNull().default(35),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  isActive: boolean("is_active").notNull().default(true)
});
var insertReadingGoalSchema = createInsertSchema(readingGoals).pick({
  userId: true,
  totalPages: true,
  dailyTarget: true,
  weeklyTarget: true,
  isActive: true
});

// server/storage.ts
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, and, gte, lte, desc, sql } from "drizzle-orm";
import postgres from "postgres";
var queryClient = postgres(process.env.DATABASE_URL);
var db = drizzle(queryClient);
var PgStorage = class {
  constructor() {
  }
  // User operations
  async getUser(id) {
    const result = await db.select().from(users).where(eq(users.id, id));
    return result[0];
  }
  async getUserByUsername(username) {
    const result = await db.select().from(users).where(eq(users.username, username));
    return result[0];
  }
  async createUser(user) {
    const result = await db.insert(users).values(user).returning();
    return result[0];
  }
  // Reading log operations
  async createReadingLog(log2) {
    const result = await db.insert(readingLogs).values(log2).returning();
    return result[0];
  }
  async getReadingLogs(userId) {
    return db.select().from(readingLogs).where(eq(readingLogs.userId, userId)).orderBy(desc(readingLogs.date), desc(readingLogs.createdAt));
  }
  async getReadingLogsByDateRange(userId, startDate, endDate) {
    return db.select().from(readingLogs).where(
      and(
        eq(readingLogs.userId, userId),
        gte(readingLogs.date, startDate.toISOString().split("T")[0]),
        lte(readingLogs.date, endDate.toISOString().split("T")[0])
      )
    ).orderBy(readingLogs.date);
  }
  async getReadingLogsByJuz(userId, juzNumber) {
    return db.select().from(readingLogs).where(
      and(
        eq(readingLogs.userId, userId),
        eq(readingLogs.juzNumber, juzNumber)
      )
    ).orderBy(desc(readingLogs.date));
  }
  async getRecentReadingLogs(userId, limit) {
    return db.select().from(readingLogs).where(eq(readingLogs.userId, userId)).orderBy(desc(readingLogs.date), desc(readingLogs.createdAt)).limit(limit);
  }
  // Reading goals operations
  async createReadingGoal(goal) {
    if (goal.isActive) {
      await db.update(readingGoals).set({ isActive: false }).where(eq(readingGoals.userId, goal.userId));
    }
    const result = await db.insert(readingGoals).values(goal).returning();
    return result[0];
  }
  async getActiveReadingGoal(userId) {
    const result = await db.select().from(readingGoals).where(
      and(
        eq(readingGoals.userId, userId),
        eq(readingGoals.isActive, true)
      )
    );
    return result[0];
  }
  async updateReadingGoal(id, goal) {
    if (goal.isActive) {
      const existingGoal = await db.select().from(readingGoals).where(eq(readingGoals.id, id)).then((res) => res[0]);
      if (existingGoal) {
        await db.update(readingGoals).set({ isActive: false }).where(and(
          eq(readingGoals.userId, existingGoal.userId),
          sql`${readingGoals.id} != ${id}`
        ));
      }
    }
    const result = await db.update(readingGoals).set(goal).where(eq(readingGoals.id, id)).returning();
    return result[0];
  }
  // Analytics operations
  async getTotalPagesRead(userId) {
    const result = await db.select({
      totalPages: sql`SUM(${readingLogs.pagesRead})`
    }).from(readingLogs).where(eq(readingLogs.userId, userId));
    return result[0]?.totalPages || 0;
  }
  async getTotalKhatmas(userId) {
    const totalPages = await this.getTotalPagesRead(userId);
    return Math.floor(totalPages / 604);
  }
  async getJuzCompletion(userId) {
    const detailedMap = await this.getDetailedJuzMap(userId);
    return detailedMap.map((item) => ({
      juzNumber: item.juzNumber,
      completed: item.status === "completed"
    }));
  }
  async getDetailedJuzMap(userId) {
    const logs = await this.getReadingLogs(userId);
    const totalPagesRead = await this.getTotalPagesRead(userId);
    const currentKhatmaPages = totalPagesRead % 604;
    const juzMap = /* @__PURE__ */ new Map();
    const pagesPerJuz = 20;
    for (let i = 1; i <= 30; i++) {
      juzMap.set(i, /* @__PURE__ */ new Set());
    }
    let remainingPages = currentKhatmaPages;
    const relevantLogs = [...logs].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );
    const currentKhatmaLogs = [];
    for (const log2 of relevantLogs) {
      if (remainingPages <= 0) break;
      const logPages = log2.pagesRead;
      if (logPages <= remainingPages) {
        currentKhatmaLogs.push(log2);
        remainingPages -= logPages;
      } else {
        const partialLog = { ...log2, pagesRead: remainingPages };
        currentKhatmaLogs.push(partialLog);
        remainingPages = 0;
      }
    }
    currentKhatmaLogs.forEach((log2) => {
      let startPage;
      if (log2.startPage) {
        startPage = log2.startPage;
      } else {
        if (log2.juzNumber === 1) {
          startPage = 1;
        } else if (log2.juzNumber === 30) {
          startPage = 582;
        } else {
          startPage = 22 + (log2.juzNumber - 2) * 20;
        }
      }
      const endPage = log2.endPage || startPage + log2.pagesRead - 1;
      for (let page = startPage; page <= endPage; page++) {
        let juzForPage;
        if (page <= 21) {
          juzForPage = 1;
        } else if (page >= 582) {
          juzForPage = 30;
        } else {
          const adjustedPage = page - 21;
          juzForPage = Math.floor(adjustedPage / 20) + 2;
        }
        const juzPages = juzMap.get(juzForPage) || /* @__PURE__ */ new Set();
        juzPages.add(page);
        juzMap.set(juzForPage, juzPages);
      }
    });
    return Array.from(juzMap.entries()).map(([juzNumber, pages]) => {
      const pagesRead = pages.size;
      let totalPagesInJuz = 20;
      if (juzNumber === 1) {
        totalPagesInJuz = 21;
      } else if (juzNumber === 30) {
        totalPagesInJuz = 23;
      }
      const percentComplete = Math.round(pagesRead / totalPagesInJuz * 100);
      let status = "not-started";
      if (pagesRead >= totalPagesInJuz) {
        status = "completed";
      } else if (pagesRead > 0) {
        status = "partial";
      }
      return {
        juzNumber,
        status,
        pagesRead,
        totalPages: totalPagesInJuz,
        percentComplete
      };
    });
  }
  async getCurrentStreak(userId) {
    const logs = await this.getReadingLogs(userId);
    if (logs.length === 0) return 0;
    const dateMap = /* @__PURE__ */ new Map();
    logs.forEach((log2) => {
      const dateStr = new Date(log2.date).toISOString().split("T")[0];
      dateMap.set(dateStr, true);
    });
    const today = /* @__PURE__ */ new Date();
    let streak = 0;
    for (let i = 0; i < 366; i++) {
      const checkDate = new Date(today);
      checkDate.setDate(today.getDate() - i);
      const checkDateStr = checkDate.toISOString().split("T")[0];
      if (dateMap.has(checkDateStr)) {
        streak++;
      } else {
        break;
      }
    }
    return streak;
  }
  async getLongestStreak(userId) {
    const logs = await this.getReadingLogs(userId);
    if (logs.length === 0) return 0;
    const sortedLogs = [...logs].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    const dateMap = /* @__PURE__ */ new Map();
    sortedLogs.forEach((log2) => {
      const dateStr = new Date(log2.date).toISOString().split("T")[0];
      dateMap.set(dateStr, true);
    });
    const dates = Array.from(dateMap.keys()).map((d) => new Date(d));
    dates.sort((a, b) => a.getTime() - b.getTime());
    let longestStreak = 0;
    let currentStreak = 1;
    for (let i = 1; i < dates.length; i++) {
      const prevDate = dates[i - 1];
      const currDate = dates[i];
      const diffTime = Math.abs(currDate.getTime() - prevDate.getTime());
      const diffDays = Math.ceil(diffTime / (1e3 * 60 * 60 * 24));
      if (diffDays === 1) {
        currentStreak++;
      } else {
        if (currentStreak > longestStreak) {
          longestStreak = currentStreak;
        }
        currentStreak = 1;
      }
    }
    return Math.max(longestStreak, currentStreak);
  }
  async getConsistencyPercentage(userId, days) {
    const endDate = /* @__PURE__ */ new Date();
    const startDate = /* @__PURE__ */ new Date();
    startDate.setDate(endDate.getDate() - days + 1);
    const logs = await this.getReadingLogsByDateRange(userId, startDate, endDate);
    const uniqueDates = /* @__PURE__ */ new Set();
    logs.forEach((log2) => {
      const dateStr = new Date(log2.date).toISOString().split("T")[0];
      uniqueDates.add(dateStr);
    });
    const daysRead = uniqueDates.size;
    return Math.round(daysRead / days * 100);
  }
  // Initialize default data
  async initializeDefaultData() {
    try {
      const existingUser = await this.getUserByUsername("user");
      if (!existingUser) {
        const defaultUser = await this.createUser({
          username: "user",
          password: "password"
        });
        await this.createReadingGoal({
          userId: defaultUser.id,
          totalPages: 604,
          dailyTarget: 5,
          weeklyTarget: 35,
          isActive: true
        });
        await this.addSampleReadingLogs(defaultUser.id);
      }
    } catch (error) {
      console.error("Error initializing default data:", error);
    }
  }
  async addSampleReadingLogs(userId) {
    const today = /* @__PURE__ */ new Date();
    for (let i = 30; i > 0; i--) {
      if (i % 5 === 0) continue;
      const date2 = /* @__PURE__ */ new Date();
      date2.setDate(today.getDate() - i);
      const dateStr = date2.toISOString().split("T")[0];
      const juzNumber = Math.min(Math.floor(i / 3) + 1, 30);
      const pagesRead = Math.floor(Math.random() * 5) + 3;
      let startPage;
      if (juzNumber === 1) {
        startPage = 1;
      } else if (juzNumber === 30) {
        startPage = 582;
      } else {
        startPage = 22 + (juzNumber - 2) * 20;
      }
      const endPage = startPage + pagesRead - 1;
      await this.createReadingLog({
        userId,
        date: dateStr,
        juzNumber,
        pagesRead,
        startPage,
        endPage
      });
    }
    const todayJuz = 5;
    const todayPagesRead = 12;
    const todayStartPage = 22 + (todayJuz - 2) * 20;
    const todayEndPage = todayStartPage + todayPagesRead - 1;
    await this.createReadingLog({
      userId,
      date: today.toISOString().split("T")[0],
      juzNumber: todayJuz,
      pagesRead: todayPagesRead,
      startPage: todayStartPage,
      endPage: todayEndPage
    });
  }
};
var storage = new PgStorage();

// server/routes.ts
import { z } from "zod";
import { fromZodError } from "zod-validation-error";

// server/db.ts
import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle as drizzle2 } from "drizzle-orm/neon-serverless";
import ws from "ws";
neonConfig.webSocketConstructor = ws;
if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?"
  );
}
var pool = new Pool({ connectionString: process.env.DATABASE_URL });
var db2 = drizzle2({ client: pool, schema: schema_exports });

// server/routes.ts
async function registerRoutes(app2) {
  app2.get("/api/reading-logs", async (req, res) => {
    try {
      const userId = 1;
      const logs = await storage.getReadingLogs(userId);
      res.json(logs);
    } catch (error) {
      console.error("Error fetching reading logs:", error);
      res.status(500).json({ message: "Failed to fetch reading logs" });
    }
  });
  app2.get("/api/reading-logs/recent", async (req, res) => {
    try {
      const userId = 1;
      const limit = req.query.limit ? parseInt(req.query.limit) : 5;
      const logs = await storage.getRecentReadingLogs(userId, limit);
      res.json(logs);
    } catch (error) {
      console.error("Error fetching recent reading logs:", error);
      res.status(500).json({ message: "Failed to fetch recent reading logs" });
    }
  });
  app2.post("/api/reading-logs", async (req, res) => {
    try {
      const validatedData = insertReadingLogSchema.parse({
        ...req.body,
        userId: 1
        // For demo purposes, use default user
      });
      const readingLog = await storage.createReadingLog(validatedData);
      res.status(201).json(readingLog);
    } catch (error) {
      if (error instanceof z.ZodError) {
        const validationError = fromZodError(error);
        res.status(400).json({ message: validationError.message });
      } else {
        console.error("Error creating reading log:", error);
        res.status(500).json({ message: "Failed to create reading log" });
      }
    }
  });
  app2.get("/api/reading-logs/date-range", async (req, res) => {
    try {
      const userId = 1;
      const startDate = req.query.startDate ? new Date(req.query.startDate) : /* @__PURE__ */ new Date(0);
      const endDate = req.query.endDate ? new Date(req.query.endDate) : /* @__PURE__ */ new Date();
      const logs = await storage.getReadingLogsByDateRange(userId, startDate, endDate);
      res.json(logs);
    } catch (error) {
      console.error("Error fetching reading logs by date range:", error);
      res.status(500).json({ message: "Failed to fetch reading logs by date range" });
    }
  });
  app2.get("/api/stats", async (req, res) => {
    try {
      const userId = 1;
      const totalPagesRead = await storage.getTotalPagesRead(userId);
      const totalKhatmas = await storage.getTotalKhatmas(userId);
      const juzCompletion = await storage.getJuzCompletion(userId);
      const completedJuz = juzCompletion.filter((j) => j.completed).length;
      const currentStreak = await storage.getCurrentStreak(userId);
      const longestStreak = await storage.getLongestStreak(userId);
      const consistency = await storage.getConsistencyPercentage(userId, 30);
      res.json({
        totalPagesRead,
        totalKhatmas,
        completedJuz,
        currentStreak,
        longestStreak,
        consistency
      });
    } catch (error) {
      console.error("Error fetching stats:", error);
      res.status(500).json({ message: "Failed to fetch stats" });
    }
  });
  app2.get("/api/reading-goals/active", async (req, res) => {
    try {
      const userId = 1;
      const goal = await storage.getActiveReadingGoal(userId);
      if (!goal) {
        return res.status(404).json({ message: "No active reading goal found" });
      }
      const totalPagesRead = await storage.getTotalPagesRead(userId);
      const completionPercentage = Math.round(totalPagesRead / goal.totalPages * 100);
      const today = /* @__PURE__ */ new Date();
      const startOfWeek = new Date(today);
      startOfWeek.setDate(today.getDate() - today.getDay());
      const weekLogs = await storage.getReadingLogsByDateRange(userId, startOfWeek, today);
      const weeklyPagesRead = weekLogs.reduce((sum, log2) => sum + log2.pagesRead, 0);
      const weeklyTargetCompletion = Math.round(weeklyPagesRead / goal.weeklyTarget * 100);
      res.json({
        ...goal,
        completionPercentage,
        weeklyTargetCompletion
      });
    } catch (error) {
      console.error("Error fetching active reading goal:", error);
      res.status(500).json({ message: "Failed to fetch active reading goal" });
    }
  });
  app2.put("/api/reading-goals/:id", async (req, res) => {
    try {
      const goalId = parseInt(req.params.id);
      const validatedData = insertReadingGoalSchema.partial().parse({
        ...req.body,
        userId: 1
        // For demo purposes, use default user
      });
      const updatedGoal = await storage.updateReadingGoal(goalId, validatedData);
      if (!updatedGoal) {
        return res.status(404).json({ message: "Reading goal not found" });
      }
      res.json(updatedGoal);
    } catch (error) {
      if (error instanceof z.ZodError) {
        const validationError = fromZodError(error);
        res.status(400).json({ message: validationError.message });
      } else {
        console.error("Error updating reading goal:", error);
        res.status(500).json({ message: "Failed to update reading goal" });
      }
    }
  });
  app2.post("/api/reading-goals", async (req, res) => {
    try {
      const validatedData = insertReadingGoalSchema.parse({
        ...req.body,
        userId: 1
        // For demo purposes, use default user
      });
      const readingGoal = await storage.createReadingGoal(validatedData);
      res.status(201).json(readingGoal);
    } catch (error) {
      if (error instanceof z.ZodError) {
        const validationError = fromZodError(error);
        res.status(400).json({ message: validationError.message });
      } else {
        console.error("Error creating reading goal:", error);
        res.status(500).json({ message: "Failed to create reading goal" });
      }
    }
  });
  app2.get("/api/juz-map", async (req, res) => {
    try {
      const userId = 1;
      const juzMap = await storage.getDetailedJuzMap(userId);
      res.json(juzMap);
    } catch (error) {
      console.error("Error fetching juz map:", error);
      res.status(500).json({ message: "Failed to fetch juz map" });
    }
  });
  app2.post("/api/clear-data", async (req, res) => {
    try {
      await pool.query(`
        TRUNCATE reading_logs RESTART IDENTITY;
      `);
      const userId = 1;
      const activeGoal = await storage.getActiveReadingGoal(userId);
      if (activeGoal) {
        await storage.updateReadingGoal(activeGoal.id, {
          userId: activeGoal.userId,
          isActive: true,
          // Keep it active
          dailyTarget: activeGoal.dailyTarget,
          // Keep targets
          weeklyTarget: activeGoal.weeklyTarget,
          totalPages: 604
          // Reset total pages to default
        });
      }
      await storage.initializeDefaultData();
      res.json({ message: "All reading data has been cleared successfully." });
    } catch (error) {
      console.error("Error clearing data:", error);
      res.status(500).json({ message: "Failed to clear data" });
    }
  });
  const httpServer = createServer(app2);
  return httpServer;
}

// server/vite.ts
import express from "express";
import fs from "fs";
import path2, { dirname as dirname2 } from "path";
import { fileURLToPath as fileURLToPath2 } from "url";
import { createServer as createViteServer, createLogger } from "vite";

// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import themePlugin from "@replit/vite-plugin-shadcn-theme-json";
import path, { dirname } from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
import { fileURLToPath } from "url";
var __filename = fileURLToPath(import.meta.url);
var __dirname = dirname(__filename);
var vite_config_default = defineConfig({
  plugins: [
    react(),
    runtimeErrorOverlay(),
    themePlugin(),
    ...process.env.NODE_ENV !== "production" && process.env.REPL_ID !== void 0 ? [
      await import("@replit/vite-plugin-cartographer").then(
        (m) => m.cartographer()
      )
    ] : []
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "client", "src"),
      "@shared": path.resolve(__dirname, "shared"),
      "@assets": path.resolve(__dirname, "attached_assets")
    }
  },
  root: path.resolve(__dirname, "client"),
  build: {
    outDir: path.resolve(__dirname, "dist"),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        assetFileNames: "assets/[name]-[hash][extname]",
        chunkFileNames: "assets/[name]-[hash].js",
        entryFileNames: "assets/[name]-[hash].js"
      }
    }
  },
  base: "./"
});

// server/vite.ts
import { nanoid } from "nanoid";
var __filename2 = fileURLToPath2(import.meta.url);
var __dirname2 = dirname2(__filename2);
var viteLogger = createLogger();
function log(message, source = "express") {
  const formattedTime = (/* @__PURE__ */ new Date()).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true
  });
  console.log(`${formattedTime} [${source}] ${message}`);
}
async function setupVite(app2, server) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true
  };
  const vite = await createViteServer({
    ...vite_config_default,
    configFile: false,
    customLogger: {
      ...viteLogger,
      error: (msg, options) => {
        viteLogger.error(msg, options);
        process.exit(1);
      }
    },
    server: serverOptions,
    appType: "custom"
  });
  app2.use(vite.middlewares);
  app2.use("*", async (req, res, next) => {
    const url = req.originalUrl;
    try {
      const clientTemplate = path2.resolve(
        __dirname2,
        "..",
        "client",
        "index.html"
      );
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e);
      next(e);
    }
  });
}
function serveStatic(app2) {
  const distPath = path2.resolve(__dirname2, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`
    );
  }
  app2.use(express.static(distPath));
  app2.use("*", (_req, res) => {
    res.sendFile(path2.resolve(distPath, "index.html"));
  });
}

// server/index.ts
import { drizzle as drizzle3 } from "drizzle-orm/postgres-js";
import { sql as sql2 } from "drizzle-orm";
import postgres2 from "postgres";
import path3 from "path";
var migrationClient = postgres2(process.env.DATABASE_URL, { max: 1 });
var app = express2();
app.use(express2.json());
app.use(express2.urlencoded({ extended: false }));
app.use((req, res, next) => {
  const start = Date.now();
  const path4 = req.path;
  let capturedJsonResponse = void 0;
  const originalResJson = res.json;
  res.json = function(bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };
  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path4.startsWith("/api")) {
      let logLine = `${req.method} ${path4} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }
      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "\u2026";
      }
      log(logLine);
    }
  });
  next();
});
app.get("/sw.js", (req, res) => {
  res.set("Content-Type", "application/javascript");
  res.sendFile(path3.resolve("./public/sw.js"));
});
app.get("/manifest.webmanifest", (req, res) => {
  res.set("Content-Type", "application/manifest+json");
  res.sendFile(path3.resolve("./public/manifest.webmanifest"));
});
(async () => {
  try {
    log("Initializing database schema...");
    const db3 = drizzle3(migrationClient, { schema: schema_exports });
    await db3.execute(sql2`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password TEXT NOT NULL
      );
      
      CREATE TABLE IF NOT EXISTS reading_logs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        date DATE NOT NULL DEFAULT CURRENT_DATE,
        juz_number INTEGER NOT NULL,
        pages_read INTEGER NOT NULL,
        start_page INTEGER,
        end_page INTEGER,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      
      CREATE TABLE IF NOT EXISTS reading_goals (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        total_pages INTEGER NOT NULL DEFAULT 604,
        daily_target INTEGER NOT NULL DEFAULT 5,
        weekly_target INTEGER NOT NULL DEFAULT 35,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        is_active BOOLEAN NOT NULL DEFAULT TRUE
      );
    `);
    await storage.initializeDefaultData();
    log("Database initialization complete");
  } catch (error) {
    log(`Database initialization error: ${error}`);
  } finally {
    await migrationClient.end();
  }
  const server = await registerRoutes(app);
  app.use((err, _req, res, _next) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    res.status(status).json({ message });
    throw err;
  });
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }
  const port = 5e3;
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true
  }, () => {
    log(`serving on port ${port}`);
  });
})();
