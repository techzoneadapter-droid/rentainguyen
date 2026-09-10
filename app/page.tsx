import EncodingRepair from './encoding-repair';
import Workspace from './workspace';
import WorkflowRunner from './workflow-runner';

export default function Page() {
  return (
    <>
      <EncodingRepair />
      <Workspace />
      <WorkflowRunner />
    </>
  );
}
