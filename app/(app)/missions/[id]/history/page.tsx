import { redirect } from "next/navigation"

/**
 * This route used to render its own events table, duplicating the History tab of the mission
 * console -- with less context around it, and nothing anywhere linking to it. Keeping two
 * implementations of the same view is how they drift apart; deleting the URL outright would
 * break anything bookmarked. So the URL survives and the duplicate does not.
 */
export default async function MissionHistoryRedirect({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  redirect(`/missions/${id}?tab=history`)
}
