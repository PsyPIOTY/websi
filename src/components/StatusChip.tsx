import { statusLabels } from "../../core/requests";
import type { RequestStatus } from "../../core/types";

export function StatusChip({ status }: { status: RequestStatus }) {
	return <span className={`chip chip--${status}`}>{statusLabels[status]}</span>;
}
