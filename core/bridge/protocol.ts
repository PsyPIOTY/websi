import type { Pin, RequestStatus, SectionDef, SiteProfile } from "../types";

/** Nachrichten zwischen Dashboard und public/websi-bridge.js (in der Website). */
export type BridgeToApp =
	| { type: "websi:hello"; path: string }
	| {
			type: "websi:ready";
			found: string[];
			missing: string[];
			path: string;
			title: string;
	  }
	| {
			type: "websi:submit";
			sectionId: string;
			text: string;
			pin?: Pin;
			path: string;
	  }
	| { type: "websi:open"; requestId: string }
	| { type: "websi:visible"; sectionId: string }
	/** Nur im Vergleich: Scrollstand, damit beide Fassungen mitlaufen. */
	| { type: "websi:scroll"; y: number };

export type AppToBridge =
	| {
			type: "websi:config";
			sections: SectionDef[];
			preview?: SiteProfile["preview"];
			/** "edit": Nachrichtenfelder; "compare": nur ansehen (Vorher/Nachher). */
			mode?: "edit" | "compare";
			/** Sammeln statt sofort senden (Beschriftung der Knöpfe). */
			collect?: boolean;
	  }
	| {
			type: "websi:state";
			bySection: Record<
				string,
				{ id: string; text: string; status: RequestStatus }[]
			>;
	  }
	| { type: "websi:scrollTo"; sectionId: string; smooth?: boolean }
	| { type: "websi:scrollY"; y: number }
	| { type: "websi:mode"; collect: boolean };

export function isBridgeMessage(data: unknown): data is BridgeToApp {
	return (
		typeof data === "object" &&
		data !== null &&
		typeof (data as { type?: unknown }).type === "string" &&
		(data as { type: string }).type.startsWith("websi:")
	);
}
