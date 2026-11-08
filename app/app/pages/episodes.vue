<template>
  <UDashboardPanel>
    <template #header>
      <UDashboardNavbar title="Episodes">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <UEmpty icon="i-lucide-podcast" title="Coming soon" description="Searchable episode table and RSS refresh." />
    </template>
  </UDashboardPanel>
</template>
