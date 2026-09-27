import { redirect } from "next/navigation"

/** Same as the history route: superseded by the Sensors tab, kept only so the URL still works. */
export default async function MissionSensorsRedirect({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  redirect(`/missions/${id}?tab=sensors`)
}
