export function ChatIntro({ workspaceName }: { workspaceName?: string }) {
  return (
    <div className="flex items-start justify-between border-b py-4">
      <div className="container flex flex-col gap-2">
        <h1 className="text-lg font-semibold md:text-2xl">
          {workspaceName ? `${workspaceName} Chat` : 'Select a Workspace'}
        </h1>
        <p className="hidden sm:block text-sm text-muted-foreground">
          {workspaceName 
            ? 'Chat with your team members in real-time'
            : 'Select or create a workspace to start chatting'}
        </p>
      </div>
    </div>
  );
}
