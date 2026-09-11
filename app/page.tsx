import BusinessManagerCreator from './business-manager-creator';
import EncodingRepair from './encoding-repair';
import MetaOAuthConnector from './meta-oauth-connector';
import TokenWorkspaceSection from './token-workspace-section';
import Workspace from './workspace';
import WorkflowRunner from './workflow-runner';

export default function Page() {
  return (
    <>
      <EncodingRepair />
      <Workspace />
      <TokenWorkspaceSection />
      <MetaOAuthConnector />
      <BusinessManagerCreator />
      <WorkflowRunner />
    </>
  );
}
