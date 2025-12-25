export interface Env {
  XAI_API_KEY: string;
  D1_DB: D1Database;
}

const PROMPT = `ここ12時間のX(旧：Twitter)での、IT技術についての話題を収集して、ホットな話題になっているIT技術情報について、以下のフォーマットで返却してください。
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

async function fetchTrendFromXai(apiKey: string): Promise<string> {
  const response = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "grok-4-1-fast",
      messages: [
        {
          role: "user",
          content: PROMPT,
        },
      ],
      temperature: 0.2,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`xAI API error: ${response.status} ${errorText}`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("xAI API response missing content");
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

export default {
  async fetch() {
    return new Response("Not Found", { status: 404 });
  },
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      (async () => {
        const now = new Date();
        const date = getJstDateString(now);
        const slot = getSlotFromJstHour(now);
        const rawResponse = await fetchTrendFromXai(env.XAI_API_KEY);
        await upsertTrendEntry(env.D1_DB, date, slot, rawResponse);
      })(),
    );
  },
};
