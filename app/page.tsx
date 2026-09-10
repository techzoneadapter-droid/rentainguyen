import BusinessManagerCreator from './business-manager-creator';
import EncodingRepair from './encoding-repair';
import TokenWorkspaceSection from './token-workspace-section';
import Workspace from './workspace';
import WorkflowRunner from './workflow-runner';

export default function Page() {
  return (
    <>
      <EncodingRepair />
      <Workspace />
      <TokenWorkspaceSection />
      <BusinessManagerCreator />
      <WorkflowRunner />
    </>
  );
}
