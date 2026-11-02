-- CreateTable
CREATE TABLE "VendorCapacity" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "completesPerDay" INTEGER,
    "completesPerMonth" INTEGER,
    "note" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorCapacity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VendorCapacity_vendorId_countryCode_key" ON "VendorCapacity"("vendorId", "countryCode");

-- AddForeignKey
ALTER TABLE "VendorCapacity" ADD CONSTRAINT "VendorCapacity_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
