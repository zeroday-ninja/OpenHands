import { useParams } from "react-router";
import { WorkbenchPage } from "#/components/features/workbench/workbench-page";

export default function WorkbenchProjectRoute() {
  const { projectId = "" } = useParams<{ projectId: string }>();
  return <WorkbenchPage projectId={projectId} />;
}
