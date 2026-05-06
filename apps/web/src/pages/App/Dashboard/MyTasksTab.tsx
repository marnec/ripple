// Thin re-export: the existing MyTasks page is already the right shape for
// the new Dashboard "My Tasks" tab. Keeping the underlying file means task
// utilities, swipe-to-advance, and the detail sheet remain owned by their
// original module; this tab is purely a routing surface.
//
// MyTasks renders its own internal page header ("My Tasks" + count), which
// is now redundant with DashboardLayout's outer header on desktop. We let
// it stay for two reasons: (1) the count badge is still useful, (2)
// changing MyTasks would ripple beyond this feature. If the duplication
// proves visually noisy in review we can hide MyTasks's inner header when
// it detects it's mounted inside the dashboard.
export { MyTasks as MyTasksTab } from "../Project/MyTasks";
