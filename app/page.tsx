import BusinessManagerCreator from './business-manager-creator';
import CrmResourcePush from './crm-resource-push';
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
      <CrmResourcePush />
      <BusinessManagerCreator />
      <WorkflowRunner />
    </>
  );
}
