import type { Idea, IdeaImage } from "../core/ideen";
import type {
	ChangeRequest,
	DirectoryEntry,
	StyleRule,
	VisibilityReport,
} from "../core/types";
import schema1 from "../migrations/0001_init.sql?raw";
import schema2 from "../migrations/0002_stil_kontingent.sql?raw";
import schema3 from "../migrations/0003_ideen.sql?raw";

const schema = `${schema1};${schema2};${schema3}`;

/** Speicher-Schnittstelle. D1 im Betrieb, Arbeitsspeicher in Tests. */
export interface Store {
	listRequests(siteId?: string): Promise<ChangeRequest[]>;
	getRequest(id: string): Promise<ChangeRequest | null>;
	putRequest(request: ChangeRequest): Promise<void>;
	latestReport(siteId: string): Promise<VisibilityReport | null>;
	reportHistory(
		siteId: string,
		limit: number,
	): Promise<{ scannedAt: string; score: number }[]>;
	saveReport(report: VisibilityReport): Promise<void>;
	listDirectories(siteId: string): Promise<DirectoryEntry[]>;
	putDirectory(entry: DirectoryEntry): Promise<void>;
	/** Regeln einer Website plus der Regeln für alle Websites. */
	listStyle(siteId: string): Promise<StyleRule[]>;
	getStyle(id: string): Promise<StyleRule | null>;
	putStyle(rule: StyleRule): Promise<void>;
	deleteStyle(id: string): Promise<void>;
	getSetting<T>(key: string): Promise<T | null>;
	putSetting(key: string, value: unknown): Promise<void>;
	/** Ideen von fremden Websites, neueste zuerst, ohne erledigte. */
	listIdeas(): Promise<Idea[]>;
	getIdea(id: string): Promise<Idea | null>;
	findIdeaBySource(quelle: string): Promise<Idea | null>;
	getIdeaImage(id: string): Promise<IdeaImage | null>;
	/** bild nur beim Anlegen; beim Ändern bleibt das Foto, wie es ist. */
	putIdea(idea: Idea, bild?: IdeaImage | null): Promise<void>;
}

interface StyleRow {
	id: string;
	siteId: string;
	text: string;
	source: StyleRule["source"];
	active: number;
	createdAt: string;
}

const fromRow = (r: StyleRow): StyleRule => ({ ...r, active: r.active === 1 });

export class D1Store implements Store {
	private ready: Promise<void> | null = null;
	constructor(private readonly db: D1Database) {}

	private init() {
		this.ready ??= (async () => {
			const statements = schema
				.split(";")
				.map((s) => s.replace(/^\s*--.*$/gm, "").trim())
				.filter(Boolean)
				.map((s) => this.db.prepare(s));
			await this.db.batch(statements);
		})();
		return this.ready;
	}

	async listRequests(siteId?: string) {
		await this.init();
		const q = siteId
			? this.db
					.prepare(
						"SELECT data FROM requests WHERE site_id = ? ORDER BY updated_at DESC",
					)
					.bind(siteId)
			: this.db.prepare(
					"SELECT data FROM requests ORDER BY updated_at DESC LIMIT 500",
				);
		const { results } = await q.all<{ data: string }>();
		return results.map((r) => JSON.parse(r.data) as ChangeRequest);
	}

	async getRequest(id: string) {
		await this.init();
		const row = await this.db
			.prepare("SELECT data FROM requests WHERE id = ?")
			.bind(id)
			.first<{ data: string }>();
		return row ? (JSON.parse(row.data) as ChangeRequest) : null;
	}

	async putRequest(r: ChangeRequest) {
		await this.init();
		await this.db
			.prepare(
				`INSERT INTO requests (id, site_id, section_id, status, data, created_at, updated_at)
				 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
				 ON CONFLICT(id) DO UPDATE SET status = ?4, data = ?5, updated_at = ?7`,
			)
			.bind(
				r.id,
				r.siteId,
				r.sectionId,
				r.status,
				JSON.stringify(r),
				r.createdAt,
				r.updatedAt,
			)
			.run();
	}

	async latestReport(siteId: string) {
		await this.init();
		const row = await this.db
			.prepare(
				"SELECT data FROM visibility_reports WHERE site_id = ? ORDER BY scanned_at DESC LIMIT 1",
			)
			.bind(siteId)
			.first<{ data: string }>();
		return row ? (JSON.parse(row.data) as VisibilityReport) : null;
	}

	async reportHistory(siteId: string, limit: number) {
		await this.init();
		const { results } = await this.db
			.prepare(
				"SELECT scanned_at AS scannedAt, score FROM visibility_reports WHERE site_id = ? ORDER BY scanned_at DESC LIMIT ?",
			)
			.bind(siteId, limit)
			.all<{ scannedAt: string; score: number }>();
		return results.reverse();
	}

	async saveReport(r: VisibilityReport) {
		await this.init();
		await this.db
			.prepare(
				"INSERT INTO visibility_reports (site_id, scanned_at, score, data) VALUES (?, ?, ?, ?)",
			)
			.bind(r.siteId, r.scannedAt, r.score, JSON.stringify(r))
			.run();
	}

	async listDirectories(siteId: string) {
		await this.init();
		const { results } = await this.db
			.prepare(
				"SELECT site_id AS siteId, directory_id AS directoryId, status, note, updated_at AS updatedAt FROM directories WHERE site_id = ?",
			)
			.bind(siteId)
			.all<DirectoryEntry>();
		return results;
	}

	async putDirectory(e: DirectoryEntry) {
		await this.init();
		await this.db
			.prepare(
				`INSERT INTO directories (site_id, directory_id, status, note, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)
				 ON CONFLICT(site_id, directory_id) DO UPDATE SET status = ?3, note = ?4, updated_at = ?5`,
			)
			.bind(e.siteId, e.directoryId, e.status, e.note, e.updatedAt)
			.run();
	}
	async listStyle(siteId: string) {
		await this.init();
		const { results } = await this.db
			.prepare(
				"SELECT id, site_id AS siteId, text, source, active, created_at AS createdAt FROM style_rules WHERE site_id IN (?, 'alle') ORDER BY created_at",
			)
			.bind(siteId)
			.all<StyleRow>();
		return results.map(fromRow);
	}

	async getStyle(id: string) {
		await this.init();
		const row = await this.db
			.prepare(
				"SELECT id, site_id AS siteId, text, source, active, created_at AS createdAt FROM style_rules WHERE id = ?",
			)
			.bind(id)
			.first<StyleRow>();
		return row ? fromRow(row) : null;
	}

	async putStyle(r: StyleRule) {
		await this.init();
		await this.db
			.prepare(
				`INSERT INTO style_rules (id, site_id, text, source, active, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
				 ON CONFLICT(id) DO UPDATE SET site_id = ?2, text = ?3, active = ?5`,
			)
			.bind(r.id, r.siteId, r.text, r.source, r.active ? 1 : 0, r.createdAt)
			.run();
	}

	async deleteStyle(id: string) {
		await this.init();
		await this.db
			.prepare("DELETE FROM style_rules WHERE id = ?")
			.bind(id)
			.run();
	}

	async getSetting<T>(key: string) {
		await this.init();
		const row = await this.db
			.prepare("SELECT value FROM settings WHERE key = ?")
			.bind(key)
			.first<{ value: string }>();
		return row ? (JSON.parse(row.value) as T) : null;
	}

	async putSetting(key: string, value: unknown) {
		await this.init();
		await this.db
			.prepare(
				"INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = ?2",
			)
			.bind(key, JSON.stringify(value))
			.run();
	}

	async listIdeas() {
		await this.init();
		const { results } = await this.db
			.prepare(
				"SELECT data FROM ideen WHERE status != 'erledigt' ORDER BY created_at DESC LIMIT 200",
			)
			.all<{ data: string }>();
		return results.map((r) => JSON.parse(r.data) as Idea);
	}

	async getIdea(id: string) {
		await this.init();
		const row = await this.db
			.prepare("SELECT data FROM ideen WHERE id = ?")
			.bind(id)
			.first<{ data: string }>();
		return row ? (JSON.parse(row.data) as Idea) : null;
	}

	async findIdeaBySource(quelle: string) {
		await this.init();
		const row = await this.db
			.prepare("SELECT data FROM ideen WHERE quelle = ?")
			.bind(quelle)
			.first<{ data: string }>();
		return row ? (JSON.parse(row.data) as Idea) : null;
	}

	async getIdeaImage(id: string) {
		await this.init();
		const row = await this.db
			.prepare("SELECT data, bild FROM ideen WHERE id = ?")
			.bind(id)
			.first<{ data: string; bild: string | null }>();
		const idea = row ? (JSON.parse(row.data) as Idea) : null;
		return row?.bild && idea?.bild ? { type: idea.bild, data: row.bild } : null;
	}

	async putIdea(idea: Idea, bild?: IdeaImage | null) {
		await this.init();
		await this.db
			.prepare(
				`INSERT INTO ideen (id, status, quelle, data, bild, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
				 ON CONFLICT(id) DO UPDATE SET status = ?2, data = ?4`,
			)
			.bind(
				idea.id,
				idea.status,
				idea.quelle ?? null,
				JSON.stringify(idea),
				bild?.data ?? null,
				idea.createdAt,
			)
			.run();
	}
}

export class MemoryStore implements Store {
	requests = new Map<string, ChangeRequest>();
	reports: VisibilityReport[] = [];
	directories = new Map<string, DirectoryEntry>();
	style = new Map<string, StyleRule>();
	settings = new Map<string, string>();
	ideas = new Map<string, { idea: Idea; bild: IdeaImage | null }>();

	async listRequests(siteId?: string) {
		return [...this.requests.values()]
			.filter((r) => !siteId || r.siteId === siteId)
			.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
	}
	async getRequest(id: string) {
		return this.requests.get(id) ?? null;
	}
	async putRequest(r: ChangeRequest) {
		this.requests.set(r.id, structuredClone(r));
	}
	async latestReport(siteId: string) {
		return this.reports.filter((r) => r.siteId === siteId).at(-1) ?? null;
	}
	async reportHistory(siteId: string, limit: number) {
		return this.reports
			.filter((r) => r.siteId === siteId)
			.slice(-limit)
			.map((r) => ({ scannedAt: r.scannedAt, score: r.score }));
	}
	async saveReport(r: VisibilityReport) {
		this.reports.push(r);
	}
	async listDirectories(siteId: string) {
		return [...this.directories.values()].filter((d) => d.siteId === siteId);
	}
	async putDirectory(e: DirectoryEntry) {
		this.directories.set(`${e.siteId}/${e.directoryId}`, e);
	}
	async listStyle(siteId: string) {
		return [...this.style.values()]
			.filter((r) => r.siteId === siteId || r.siteId === "alle")
			.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
	}
	async getStyle(id: string) {
		return this.style.get(id) ?? null;
	}
	async putStyle(r: StyleRule) {
		this.style.set(r.id, { ...r });
	}
	async deleteStyle(id: string) {
		this.style.delete(id);
	}
	async getSetting<T>(key: string) {
		const v = this.settings.get(key);
		return v === undefined ? null : (JSON.parse(v) as T);
	}
	async putSetting(key: string, value: unknown) {
		this.settings.set(key, JSON.stringify(value));
	}
	async listIdeas() {
		return [...this.ideas.values()]
			.map((x) => structuredClone(x.idea))
			.filter((i) => i.status !== "erledigt")
			.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
	}
	async getIdea(id: string) {
		const x = this.ideas.get(id);
		return x ? structuredClone(x.idea) : null;
	}
	async findIdeaBySource(quelle: string) {
		const x = [...this.ideas.values()].find((v) => v.idea.quelle === quelle);
		return x ? structuredClone(x.idea) : null;
	}
	async getIdeaImage(id: string) {
		return this.ideas.get(id)?.bild ?? null;
	}
	async putIdea(idea: Idea, bild?: IdeaImage | null) {
		const old = this.ideas.get(idea.id);
		this.ideas.set(idea.id, {
			idea: structuredClone(idea),
			bild: old ? old.bild : (bild ?? null),
		});
	}
}
