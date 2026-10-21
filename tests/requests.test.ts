import { describe, expect, it } from "vitest";
import {
	canTransition,
	createRequest,
	RequestError,
	summarizeBySection,
	validateNewRequest,
	withStatus,
} from "../core/requests";

const now = "2026-10-21T20:00:00.000Z";

describe("Aufträge", () => {
	it("prüft Eingaben und begrenzt die Pin-Position", () => {
		const input = validateNewRequest({
			siteId: "praxis",
			sectionId: "offers",
			text: "  Kürzer bitte  ",
			pagePath: "/",
			pin: { x: 140, y: -3, hint: "Paartherapie" },
		});
		expect(input.text).toBe("Kürzer bitte");
		expect(input.pin).toEqual({ x: 100, y: 0, hint: "Paartherapie" });
		expect(() =>
			validateNewRequest({ siteId: "praxis", sectionId: "x", text: " " }),
		).toThrow(RequestError);
	});

	it("erlaubt Veröffentlichen nur aus einem Vorschlag heraus", () => {
		expect(canTransition("offen", "veroeffentlicht")).toBe(false);
		expect(canTransition("vorschlag", "veroeffentlicht")).toBe(true);
		const r = createRequest(
			{ siteId: "praxis", sectionId: "faq", text: "x", pagePath: "/" },
			"id1",
			now,
		);
		expect(() => withStatus(r, "veroeffentlicht", now)).toThrow(RequestError);
		const next = withStatus(r, "in_arbeit", now, {
			kind: "gesendet",
			text: "ok",
			by: "testmodus",
		});
		expect(next.status).toBe("in_arbeit");
		expect(next.events).toHaveLength(2);
	});

	it("fasst je Abschnitt den wichtigsten Status zusammen", () => {
		const a = createRequest(
			{ siteId: "p", sectionId: "faq", text: "a", pagePath: "/" },
			"a",
			now,
		);
		const b = { ...a, id: "b", status: "vorschlag" as const };
		const c = { ...a, id: "c", status: "veroeffentlicht" as const };
		const s = summarizeBySection([a, b, c]);
		expect(s.faq).toEqual({ open: 2, total: 3, top: "vorschlag" });
	});
});
