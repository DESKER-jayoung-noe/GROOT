import type { PrismaClient } from "@prisma/client";

export async function getOrCreateSettings(prisma: PrismaClient) {
  let s = await prisma.appSettings.findUnique({ where: { id: "global" } });
  if (!s) {
    s = await prisma.appSettings.create({
      data: {
        id: "global",
        pricingVersion: 1,
        sheetPricesJson: "{}",
        edgePricesJson: "{}",
        processPricesJson: "{}",
      },
    });
  }
  return s;
}
