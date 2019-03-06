vlocity_cmt.TelcoAdminConsoleController telcoAdminConsoleController = new vlocity_cmt.TelcoAdminConsoleController();
telcoAdminConsoleController.setParameters('{"methodName":"refreshPricebook"}');
telcoAdminConsoleController.invokeMethod();

telcoAdminConsoleController.setParameters('{"methodName":"startProductHierarchyJob"}');
telcoAdminConsoleController.invokeMethod();
