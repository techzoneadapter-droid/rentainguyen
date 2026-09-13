import BulkHealthCheck from './bulk-health-check';
import BmTokenCreatorHub from './bm-token-creator-hub';
import CopyPolish from './copy-polish';
import CrmResourcePush from './crm-resource-push';
import EncodingRepair from './encoding-repair';
import EztoolDashboard from './eztool-dashboard';
import GuideWorkspaceSection from './guide-workspace-section';
import MetaOAuthConnector from './meta-oauth-connector';
import ProductionQueue from './production-queue';
import ResourceCenter from './resource-center';
import ResourcePresetManager from './resource-preset-manager';
import TokenWorkspaceSection from './token-workspace-section';
import WorkflowRunner from './workflow-runner';

export default function Page() {
  return (
    <>
      <EncodingRepair />
      <CopyPolish />
      <EztoolDashboard />
      <BmTokenCreatorHub />
      <ResourceCenter />
      <BulkHealthCheck />
      <ProductionQueue />
      <ResourcePresetManager />
      <GuideWorkspaceSection />
      <TokenWorkspaceSection />
      <MetaOAuthConnector />
      <CrmResourcePush />
      <WorkflowRunner />
    </>
  );
}
