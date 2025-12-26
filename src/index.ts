export interface Env {
  XAI_API_KEY: string;
  D1_DB: D1Database;
}

const PROMPT = `ここ24時間のX(旧：Twitter)での、IT技術についての話題を収集して、ホットな話題になっているIT技術情報について、以下のフォーマットで返却してください。
情報の記述形式は、シンプルな「見出し＋簡潔な内容」、での箇条書きでお願いします。

-----

■最新のIT技術トレンド情報
[[ここに収集した情報を入れる]]

■最新のIT脆弱性情報
[[ここに収集した情報を入れる]]


`;

function getJstDateString(date: Date): string {
  const jstOffsetMs = 9 * 60 * 60 * 1000;
  const jstDate = new Date(date.getTime() + jstOffsetMs);
  return jstDate.toISOString().slice(0, 10);
}

function getSlotFromJstHour(date: Date): 0 | 1 {
  const jstOffsetMs = 9 * 60 * 60 * 1000;
  const jstDate = new Date(date.getTime() + jstOffsetMs);
  return jstDate.getUTCHours() < 12 ? 0 : 1;
}

async function fetchTrendFromXai(apiKey: string, fromDate: string, toDate: string): Promise<string> {
  const response = await fetch("https://api.x.ai/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "grok-4-1-fast",
      input: [
        {
          role: "user",
          content: PROMPT,
        },
      ],
      tools: [
        {
          type: "x_search",
          from_date: fromDate,
          to_date: toDate,
        },
      ],
      tool_choice: "auto",
      temperature: 0.2,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`xAI API error: ${response.status} ${errorText}`);
  }

  const payload = (await response.json()) as {
    error?: {
      message?: string;
      type?: string;
      code?: string;
    };
    output_text?: string;
    output?: Array<{
      content?: Array<{
        type?: string;
        text?: string;
      }>;
    }>;
  };

  if (payload.error) {
    const details = [payload.error.type, payload.error.code, payload.error.message]
      .filter(Boolean)
      .join(" ");
    throw new Error(`xAI API error response: ${details || "unknown error"}`);
  }

  if (payload.output_text && payload.output_text.trim().length > 0) {
    return payload.output_text;
  }

  const outputParts = payload.output ?? [];
  if (outputParts.length === 0) {
    throw new Error("xAI API response missing output content");
  }

  const content = outputParts
    .flatMap((item) => item.content ?? [])
    .filter((item) => item.type === "output_text" || item.type === "text")
    .map((item) => item.text?.trim())
    .filter((text): text is string => Boolean(text))
    .join("\n");

  if (!content) {
    throw new Error("xAI API response missing output text content");
  }

  return content;
}

async function upsertTrendEntry(
  db: D1Database,
  date: string,
  slot: 0 | 1,
  rawResponse: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO trend_entries (date, slot, raw_response, fetched_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(date, slot)
       DO UPDATE SET raw_response = excluded.raw_response, fetched_at = excluded.fetched_at`,
    )
    .bind(date, slot, rawResponse, new Date().toISOString())
    .run();
}

async function hasTrendEntry(db: D1Database, date: string, slot: 0 | 1): Promise<boolean> {
  const result = await db
    .prepare("SELECT 1 as exists_flag FROM trend_entries WHERE date = ? AND slot = ? LIMIT 1")
    .bind(date, slot)
    .first<{ exists_flag: number }>();
  return Boolean(result?.exists_flag);
}

export default {
  async fetch() {
    return new Response("Not Found", { status: 404 });
  },
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      (async () => {
        const now = new Date(event.scheduledTime);
        const date = getJstDateString(now);
        const slot = getSlotFromJstHour(now);
        const alreadyExists = await hasTrendEntry(env.D1_DB, date, slot);
        if (alreadyExists) {
          console.log(`Skipping xAI fetch: entry already exists for date=${date} slot=${slot}.`);
          return;
        }
        console.log(`Fetching xAI trends for date=${date} slot=${slot}.`);
        const rawResponse = await fetchTrendFromXai(env.XAI_API_KEY, date, date);
        await upsertTrendEntry(env.D1_DB, date, slot, rawResponse);
      })(),
    );
  },
};
