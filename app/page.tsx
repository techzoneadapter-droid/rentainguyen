import BulkHealthCheck from './bulk-health-check';
import BusinessManagerCreator from './business-manager-creator';
import CopyPolish from './copy-polish';
import CrmResourcePush from './crm-resource-push';
import EncodingRepair from './encoding-repair';
import GuideWorkspaceSection from './guide-workspace-section';
import MetaOAuthConnector from './meta-oauth-connector';
import ProductionQueue from './production-queue';
import ResourceCenter from './resource-center';
import TokenWorkspaceSection from './token-workspace-section';
import Workspace from './workspace';
import WorkflowRunner from './workflow-runner';

export default function Page() {
  return (
    <>
      <EncodingRepair />
      <CopyPolish />
      <Workspace />
      <ResourceCenter />
      <BulkHealthCheck />
      <ProductionQueue />
      <GuideWorkspaceSection />
      <TokenWorkspaceSection />
      <MetaOAuthConnector />
      <CrmResourcePush />
      <BusinessManagerCreator />
      <WorkflowRunner />
    </>
  );
}
