import { Response, Router } from 'express';
import asyncHandler from 'express-async-handler';
import { get } from 'lodash';
import urljoin from 'url-join';

import { DEFAULT_CONTENT_TYPE } from '../config';
import { PaginationHelper } from '../helpers/paginator';
import { getLogger } from '../logging';
import { AuthzGuards, AuthzRequest, guard } from '../middlewares/authz-guards';
import { createSerializer as createOrganizationSerializer } from '../serializers/OrganizationSerializer';
import { AuthzService } from '../services/auth0-authz';
import { ResponseMeta, SuccessResponse } from '../types/response';

import { queryParamGroup } from '.';

const logger = getLogger();

const getAdminRouter = (basePath: string = '/', routePath: string = '/management/organizations') => {
  const router: Router = Router();
  const path = urljoin(basePath, routePath);

  router.get(
    path,
    guard.enforcePrimaryGroup(true),
    AuthzGuards.readUsersGuard,
    asyncHandler(async (req: AuthzRequest, res: Response) => {
      const authzService: AuthzService = req.app.locals.authzService;

      const include = queryParamGroup(<string>req.query.include);
      const pageNumber = get(req.query, 'page.number', 0);
      const pageSize = get(req.query, 'page.size', 25);

      const pageOptions = {
        page: Math.max(parseInt(<string>pageNumber), 1),
        size: Math.min(Math.max(parseInt(<string>pageSize), 0), 25),
      };

      const groups = (await authzService.getGroups()).groups
        .filter((group) => 'nested' in group)
        .map((group) => (({ name, description, _id }) => ({ name, description, id: _id }))(group));

      const paginationOffset = (pageOptions.page - 1) * pageOptions.size;

      const paginatedGroups = groups.slice(paginationOffset, paginationOffset + pageOptions.size);

      const paginator = new PaginationHelper({
        sizeTotal: groups.length,
        pageSize: pageOptions.size,
        currentPage: pageOptions.page,
      });
      const paginationLinks = paginator.getPaginationLinks(req.path, req.query);

      const meta: ResponseMeta = {
        results: groups.length,
        pagination: {
          total: paginator.getPageCount(),
          size: pageOptions.size,
        },
      };

      const code = 200;
      const response = createOrganizationSerializer([], paginationLinks, meta).serialize(paginatedGroups);

      res.setHeader('Content-Type', DEFAULT_CONTENT_TYPE);
      res.status(code).send(response);
    })
  );

  return router;
};

export default { getAdminRouter };
