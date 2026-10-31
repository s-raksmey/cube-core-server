import { randomUUID } from "node:crypto";
import { ArticleStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionPayload } from "@/src/lib/auth/session";

const mocks=vi.hoisted(()=>({find:vi.fn(),update:vi.fn(),permissions:vi.fn(),saveHero:vi.fn(),saveThumbnail:vi.fn(),remove:vi.fn()}));
vi.mock("@/src/lib/db",()=>({prisma:{article:{findFirst:mocks.find},$transaction:async(work:(tx:unknown)=>Promise<unknown>)=>work({article:{update:mocks.update}})}}));
vi.mock("@/src/modules/roles/role-permission.service",()=>({getTenantUserPermissions:mocks.permissions}));
vi.mock("@/src/modules/articles/article-role-access",()=>({assertCanManageArticleAuthor:vi.fn(),articleAuthorRoles:async()=>new Map()}));
vi.mock("@/src/modules/auth/audit-auth",()=>({writeAuthAudit:vi.fn()}));
vi.mock("@/src/modules/articles/article-image.service",()=>({saveArticleHero:mocks.saveHero,saveArticleThumbnail:mocks.saveThumbnail,saveArticleContentImage:vi.fn(),removeArticleThumbnail:mocks.remove}));
import { createArticle, updateArticle } from "@/src/modules/articles/article.service";

const session:SessionPayload={userId:randomUUID(),tenantId:randomUUID(),role:"ADMIN",audience:"TENANT_APP",sessionId:randomUUID()};
const id=randomUUID();
const existing=`/storage/tenants/${session.tenantId}/articles/${id}/${randomUUID()}.avif`;
const uploaded=`/storage/tenants/${session.tenantId}/articles/${id}/${randomUUID()}.avif`;
const image={fileName:"hero.png",mimeType:"image/png",contentBase64:"YWJj"};
const row={uuid:id,status:ArticleStatus.DRAFT,createdByUuid:session.userId,title:"Article",slug:"article",content:"Body",heroImageUrl:existing,featuredImageUrl:"https://example.com/featured.jpg",categoryUuid:randomUUID(),subcategoryUuid:randomUUID(),translations:[],isBreaking:false,isFeatured:true,category:{name:"News"},createdBy:null,subcategory:{translations:[]},tags:[],reviews:[],updatedAt:new Date(),createdAt:new Date()};
beforeEach(()=>{vi.resetAllMocks();mocks.permissions.mockResolvedValue(["ARTICLE_VIEW","ARTICLE_UPDATE_OWN","ARTICLE_CREATE"]);mocks.find.mockResolvedValue(row);mocks.update.mockResolvedValue({uuid:id});mocks.saveHero.mockResolvedValue(uploaded);mocks.remove.mockResolvedValue(undefined)});

describe("optional tenant-owned article hero",()=>{
 it("rejects another tenant's image URL",async()=>{
  const foreign=existing.replace(session.tenantId,randomUUID());
  await expect(updateArticle(session,id,{heroImageUrl:foreign})).rejects.toMatchObject({extensions:{code:"VALIDATION"}});
  expect(mocks.update).not.toHaveBeenCalled();expect(mocks.saveHero).not.toHaveBeenCalled();
 });
 it("rejects another article's image, even in the same tenant",async()=>{
  await expect(updateArticle(session,id,{heroImageUrl:existing.replace(id,randomUUID())})).rejects.toMatchObject({extensions:{code:"VALIDATION"}});
 });
 it("uploads with authenticated scope and preserves the normal featured image",async()=>{
  await updateArticle(session,id,{heroImageUpload:image});
  expect(mocks.saveHero).toHaveBeenCalledWith(session.tenantId,id,image);
  expect(mocks.update.mock.calls[0][0]).toMatchObject({where:{uuid:id,tenantUuid:session.tenantId},data:{heroImageUrl:uploaded,featuredImageUrl:undefined}});
  expect(mocks.remove).toHaveBeenCalledWith(session.tenantId,id,existing);
 });
 it("leaves existing articles and omitted hero fields unchanged",async()=>{
  await updateArticle(session,id,{title:"Changed"});
  expect(mocks.update.mock.calls[0][0].data.heroImageUrl).toBeUndefined();
  expect(mocks.saveHero).not.toHaveBeenCalled();expect(mocks.remove).not.toHaveBeenCalled();
 });
 it("removes an optional hero explicitly",async()=>{
  await updateArticle(session,id,{heroImageUrl:null});
  expect(mocks.update.mock.calls[0][0].data.heroImageUrl).toBeNull();
  expect(mocks.remove).toHaveBeenCalledWith(session.tenantId,id,existing);
 });
 it("cleans the newly uploaded hero after a failed transaction without deleting the old one",async()=>{
  mocks.update.mockRejectedValue(new Error("Database unavailable"));
  await expect(updateArticle(session,id,{heroImageUpload:image})).rejects.toThrow("Database unavailable");
  expect(mocks.remove).toHaveBeenCalledWith(session.tenantId,id,uploaded);
  expect(mocks.remove).not.toHaveBeenCalledWith(session.tenantId,id,existing);
 });
 it("cleans a staged thumbnail if hero processing fails",async()=>{
  mocks.saveThumbnail.mockResolvedValue(uploaded);mocks.saveHero.mockRejectedValue(new Error("Invalid image"));
  await expect(updateArticle(session,id,{thumbnailUpload:image,heroImageUpload:image})).rejects.toThrow("Invalid image");
  expect(mocks.remove).toHaveBeenCalledWith(session.tenantId,id,uploaded);expect(mocks.update).not.toHaveBeenCalled();
 });
 it("does not accept a media URL on creation",async()=>{
  await expect(createArticle(session,{title:"Article",slug:"article",content:"Body",categoryId:row.categoryUuid,subcategoryId:row.subcategoryUuid,heroImageUrl:existing})).rejects.toMatchObject({extensions:{code:"VALIDATION"}});
 });
 it("retains the existing update permission guard",async()=>{
  mocks.permissions.mockResolvedValue(["ARTICLE_VIEW"]);
  await expect(updateArticle(session,id,{heroImageUpload:image})).rejects.toMatchObject({extensions:{code:"FORBIDDEN"}});
  expect(mocks.saveHero).not.toHaveBeenCalled();
 });
});
