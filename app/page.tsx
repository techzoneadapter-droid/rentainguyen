import BusinessManagerCreator from './business-manager-creator';
import EncodingRepair from './encoding-repair';
import Workspace from './workspace';
import WorkflowRunner from './workflow-runner';

export default function Page() {
  return (
    <>
      <EncodingRepair />
      <Workspace />
      <BusinessManagerCreator />
      <WorkflowRunner />
    </>
  );
}
